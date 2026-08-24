-- Receipt recognition: a usage ledger, and the console query over it.
--
-- Why this exists: /receipts/scan is the only endpoint in the product whose
-- cost is a per-call charge to an upstream model rather than a row in Postgres,
-- and it was the one endpoint with no numbers anywhere. The console could turn
-- it off and choose its model, but nobody could answer "how often is it used",
-- "how often does it fail", or "what did it cost last month" — the figures
-- existed only as a console.log line in Vercel's log drain, which ages out and
-- cannot be aggregated.
--
-- The rate limit (30/hour/user) has the same blind spot: it is enforced, and
-- until now there was no way to see whether anyone was hitting it.
--
-- The photo is never recorded here, and neither is anything read off it. A
-- receipt carries a card's last four digits and where somebody was at what
-- time; what this table holds is the shape of the call — which model, how long,
-- how many tokens, did it work — and nothing about the purchase.


-- ============================================================
-- The ledger.
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."receipt_scan_logs" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  -- Nullable and ON DELETE SET NULL: an account deletion must never be blocked
  -- by a diagnostics table, and the aggregate stays correct without the name.
  "user_id" "uuid",
  "model" "text" NOT NULL,
  "provider" "text" NOT NULL,
  -- Three outcomes, not a boolean. "The model answered, and said it could not
  -- read this" is a completely different problem from "the upstream failed" —
  -- the first is a camera/UX issue, the second is an outage or a quota — and a
  -- single ok flag would merge exactly the two numbers worth telling apart.
  "outcome" "text" NOT NULL,
  -- Populated for outcome='failed' only. The exception message, which is ours
  -- and never contains the image or the model's reading of it.
  "failure_reason" "text",
  -- Time spent upstream, measured around the provider call: separates the
  -- model's latency from the round trip carrying a ~400 KB photo to get here.
  "upstream_ms" integer NOT NULL,
  "image_bytes" integer NOT NULL,
  -- Null where the provider does not report it, never 0: a missing measurement
  -- and a genuine zero mean opposite things on a spend chart.
  "input_tokens" integer,
  "output_tokens" integer,
  "thought_tokens" integer,
  -- Gemini-only. Image tokens rather than bytes are what a vision model spends
  -- time on, so this is what tells "the photo is too big" apart from "the model
  -- is slow today".
  "image_tokens" integer,
  "attempts" integer,
  -- Estimated spend in millionths of a USD. A Haiku scan is about US$0.0005 —
  -- in cents that rounds to zero, and a column of zeros is not a cost report.
  -- Integer so a month's total cannot drift the way a summed float does.
  "cost_micros" integer,
  CONSTRAINT "receipt_scan_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receipt_scan_logs_outcome_check"
    CHECK (("outcome" = ANY (ARRAY['recognised'::"text", 'unrecognised'::"text", 'failed'::"text"])))
);

ALTER TABLE "public"."receipt_scan_logs" OWNER TO "postgres";

ALTER TABLE ONLY "public"."receipt_scan_logs"
  ADD CONSTRAINT "receipt_scan_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;

-- Every console query is "the last N days", newest first.
CREATE INDEX IF NOT EXISTS "receipt_scan_logs_created_idx"
  ON "public"."receipt_scan_logs" USING "btree" ("created_at" DESC);

-- Serves the per-user rollup, and covers the foreign key so a user delete does
-- not sequential-scan this table.
CREATE INDEX IF NOT EXISTS "receipt_scan_logs_user_idx"
  ON "public"."receipt_scan_logs" USING "btree" ("user_id", "created_at" DESC);

-- Same posture as ops_heartbeats and api_rate_limits: service_role only, RLS on
-- with no policies so an accidental grant to anon/authenticated still denies.
ALTER TABLE "public"."receipt_scan_logs" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."receipt_scan_logs" TO "service_role";


-- ============================================================
-- Write one row.
-- ============================================================
--
-- A whole-record jsonb argument rather than fourteen parameters, matching
-- upsert_recurring_expense: adding a measurement later is then a change to the
-- caller and this body, not a new function signature to migrate every caller to.
--
-- Returns void. The caller treats recording as best-effort — a scan the user
-- already paid for must not fail because the bookkeeping did.
CREATE OR REPLACE FUNCTION "public"."log_receipt_scan"("p_payload" "jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into receipt_scan_logs (
    user_id, model, provider, outcome, failure_reason,
    upstream_ms, image_bytes,
    input_tokens, output_tokens, thought_tokens, image_tokens, attempts, cost_micros
  )
  values (
    nullif(p_payload ->> 'user_id', '')::uuid,
    p_payload ->> 'model',
    p_payload ->> 'provider',
    p_payload ->> 'outcome',
    -- Truncated: an upstream can return a long body in its error message, and
    -- this column is read as a one-line label in a table cell.
    left(nullif(p_payload ->> 'failure_reason', ''), 300),
    coalesce((p_payload ->> 'upstream_ms')::integer, 0),
    coalesce((p_payload ->> 'image_bytes')::integer, 0),
    (p_payload ->> 'input_tokens')::integer,
    (p_payload ->> 'output_tokens')::integer,
    (p_payload ->> 'thought_tokens')::integer,
    (p_payload ->> 'image_tokens')::integer,
    (p_payload ->> 'attempts')::integer,
    (p_payload ->> 'cost_micros')::integer
  );
$$;

ALTER FUNCTION "public"."log_receipt_scan"("jsonb") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."log_receipt_scan"("jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_receipt_scan"("jsonb") TO "service_role";


-- ============================================================
-- The console's read.
-- ============================================================
--
-- One round trip for the whole panel. Five separate endpoints would each pay
-- the auth check and the window filter again to answer questions that are all
-- the same scan of the same days.
--
-- Bucketed in Asia/Taipei like admin_console_trends, for the same reason: a
-- 21:00 scan must not land on tomorrow.
--
-- No admin check in here. Every admin_console_* function is called only after
-- the handler has resolved the caller's role (see handlers/admin.ts), and the
-- service-role-only EXECUTE grant is what keeps that the single door.
CREATE OR REPLACE FUNCTION "public"."admin_console_receipt_scan_usage"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with bounds as (
    select least(greatest(coalesce(p_days, 30), 1), 180) as days
  ),
  window_rows as (
    select *
    from receipt_scan_logs
    -- The boundary is local midnight, converted back to an instant. Comparing
    -- a timestamptz against a bare date would resolve the date in the session's
    -- timezone (UTC) and slide the window eight hours off the buckets below.
    where created_at >= timezone(
      'Asia/Taipei',
      (((timezone('Asia/Taipei', now()))::date - ((select days from bounds) - 1))::timestamp)
    )
  ),
  days as (
    select generate_series(
      (timezone('Asia/Taipei', now()))::date - ((select days from bounds) - 1),
      (timezone('Asia/Taipei', now()))::date,
      interval '1 day'
    )::date as day
  ),
  per_day as (
    select
      (timezone('Asia/Taipei', created_at))::date as day,
      count(*) as scans,
      count(*) filter (where outcome = 'failed') as failed,
      coalesce(sum(cost_micros), 0) as cost_micros
    from window_rows
    group by 1
  )
  select jsonb_build_object(
    'days', (select days from bounds),
    'summary', (
      select jsonb_build_object(
        'scans', count(*),
        'recognised', count(*) filter (where outcome = 'recognised'),
        'unrecognised', count(*) filter (where outcome = 'unrecognised'),
        'failed', count(*) filter (where outcome = 'failed'),
        'users', count(distinct user_id),
        'cost_micros', coalesce(sum(cost_micros), 0),
        -- Median and p95, not a mean: one 12-second timeout drags an average
        -- far enough to hide what a normal scan actually feels like.
        'p50_ms', percentile_disc(0.5) within group (order by upstream_ms),
        'p95_ms', percentile_disc(0.95) within group (order by upstream_ms),
        'latest_at', max(created_at)
      )
      from window_rows
    ),
    -- generate_series drives this, not the data: a quiet day has to come back
    -- as a zero or the chart closes the gap and a dead week looks flat.
    'by_day', coalesce((
      select jsonb_agg(to_jsonb(point.*) order by point.day)
      from (
        select
          d.day::text as day,
          coalesce(p.scans, 0)::int as scans,
          coalesce(p.failed, 0)::int as failed,
          coalesce(p.cost_micros, 0)::bigint as cost_micros
        from days d
        left join per_day p on p.day = d.day
      ) point
    ), '[]'::jsonb),
    'by_model', coalesce((
      select jsonb_agg(to_jsonb(entry.*) order by entry.scans desc)
      from (
        select
          model,
          provider,
          count(*)::int as scans,
          count(*) filter (where outcome = 'failed')::int as failed,
          coalesce(sum(cost_micros), 0)::bigint as cost_micros,
          percentile_disc(0.5) within group (order by upstream_ms)::int as p50_ms
        from window_rows
        group by model, provider
      ) entry
    ), '[]'::jsonb),
    -- Who is spending it. Ten is enough to spot one runaway client, which is
    -- the only question this list is here to answer.
    'top_users', coalesce((
      select jsonb_agg(to_jsonb(entry.*) order by entry.scans desc)
      from (
        select
          w.user_id::text as user_id,
          coalesce(u.email, '(已刪除)') as email,
          count(*)::int as scans,
          count(*) filter (where w.outcome = 'failed')::int as failed,
          coalesce(sum(w.cost_micros), 0)::bigint as cost_micros
        from window_rows w
        left join users u on u.id = w.user_id
        group by w.user_id, u.email
        order by count(*) desc
        limit 10
      ) entry
    ), '[]'::jsonb),
    -- The failures themselves, because "12% failed" is where the question
    -- starts and the upstream's own message is where it usually ends.
    'recent_failures', coalesce((
      select jsonb_agg(to_jsonb(entry.*) order by entry.created_at desc)
      from (
        select
          w.created_at,
          w.model,
          coalesce(w.failure_reason, '') as failure_reason,
          coalesce(u.email, '(已刪除)') as email
        from window_rows w
        left join users u on u.id = w.user_id
        where w.outcome = 'failed'
        order by w.created_at desc
        limit 10
      ) entry
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_receipt_scan_usage"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_receipt_scan_usage"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_receipt_scan_usage"("p_days" integer) TO "service_role";


-- ============================================================
-- Retention.
-- ============================================================
--
-- Shipped with the table rather than "later": this is a row per scan with
-- nothing to cap it, on a database whose free plan stops at 500 MB. The console
-- offers at most a 180-day window, so anything past a year is storage nobody
-- can look at.
--
-- Called from the nightly workflow next to purge_read_notifications, so a
-- failure turns that run red instead of going quiet inside the database.
CREATE OR REPLACE FUNCTION "public"."purge_receipt_scan_logs"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted bigint;
begin
  delete from receipt_scan_logs
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 365), 30));

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

ALTER FUNCTION "public"."purge_receipt_scan_logs"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."purge_receipt_scan_logs"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_receipt_scan_logs"("p_days" integer) TO "service_role";
