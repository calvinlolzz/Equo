-- Admin console: growth trends and an operations health card.
--
-- The overview tiles answer "how many" but never "which way". Four numbers and
-- a 7-day comparison cannot show that signups stalled three weeks ago, so the
-- console gets a daily series to plot.
--
-- The health card exists because the pieces that tell you the service is
-- healthy live in three different places today: the uptime monitor pings
-- /api/v1/health, the nightly encrypted dump is a GitHub Actions artifact, and
-- the rate limiter's state is a table nobody looks at. None of that is visible
-- from the console, which is where someone actually looks when something feels
-- wrong.


-- ============================================================
-- Ops heartbeats: "this scheduled job last succeeded at T".
-- ============================================================
--
-- Written by the backup workflow after a dump completes (see
-- .github/workflows/db-backup.yml). Recording it in the database rather than
-- reading the GitHub API keeps the console free of a second credential, and
-- makes the interesting failure - the job silently stopping - show up as a
-- timestamp going stale, which is exactly what the card renders.
CREATE TABLE IF NOT EXISTS "public"."ops_heartbeats" (
  -- Job identifier, e.g. 'db_backup'. One row per job, upserted.
  "kind" "text" NOT NULL,
  "last_success_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  -- Free-form job facts (dump size, row counts, duration).
  "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
  CONSTRAINT "ops_heartbeats_pkey" PRIMARY KEY ("kind")
);

ALTER TABLE "public"."ops_heartbeats" OWNER TO "postgres";

-- Same posture as api_rate_limits: service_role only, RLS on with no policies
-- so an accidental grant to anon/authenticated still denies.
ALTER TABLE "public"."ops_heartbeats" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."ops_heartbeats" TO "service_role";


CREATE OR REPLACE FUNCTION "public"."record_ops_heartbeat"("p_kind" "text", "p_detail" "jsonb" DEFAULT '{}'::"jsonb")
  RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := now();
begin
  insert into ops_heartbeats (kind, last_success_at, detail)
  values (p_kind, v_now, coalesce(p_detail, '{}'::jsonb))
  on conflict (kind) do update
    set last_success_at = v_now,
        detail = coalesce(p_detail, '{}'::jsonb);

  return jsonb_build_object('kind', p_kind, 'last_success_at', v_now);
end;
$$;

ALTER FUNCTION "public"."record_ops_heartbeat"("text", "jsonb") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."record_ops_heartbeat"("text", "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_ops_heartbeat"("text", "jsonb") TO "service_role";


-- ============================================================
-- Rate limiter: count what was actually turned away.
-- ============================================================
--
-- api_rate_limits stored request_count only, so "the limiter is working" and
-- "the limiter is rejecting a flood right now" looked identical. blocked_count
-- is incremented in the same statement that already writes the row, so this
-- costs nothing on the hot path.
ALTER TABLE "public"."api_rate_limits"
  ADD COLUMN IF NOT EXISTS "blocked_count" integer DEFAULT 0 NOT NULL;


CREATE OR REPLACE FUNCTION "public"."consume_rate_limit"(
  "p_bucket" "text",
  "p_limit" integer,
  "p_window_seconds" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := now();
  v_window timestamptz;
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_rate_limit needs a positive limit and window';
  end if;

  insert into api_rate_limits as l (bucket, window_start, request_count, blocked_count)
  values (p_bucket, v_now, 1, 0)
  on conflict (bucket) do update
    set request_count = case
          when l.window_start <= v_now - make_interval(secs => p_window_seconds) then 1
          else l.request_count + 1
        end,
        window_start = case
          when l.window_start <= v_now - make_interval(secs => p_window_seconds) then v_now
          else l.window_start
        end,
        -- Reset alongside the window, and count this request as blocked when it
        -- is the one that goes over. Computed from the same pre-update values
        -- as request_count above, so the two can never disagree.
        blocked_count = case
          when l.window_start <= v_now - make_interval(secs => p_window_seconds) then 0
          when l.request_count + 1 > p_limit then l.blocked_count + 1
          else l.blocked_count
        end
  returning l.window_start, l.request_count into v_window, v_count;

  -- Amortised garbage collection. Every bucket stops being interesting one
  -- window after its last request, but nothing else would ever delete it, so a
  -- table defending against unbounded growth would itself grow without bound.
  -- One sweep per ~1000 calls keeps it flat at negligible cost.
  if random() < 0.001 then
    delete from api_rate_limits where window_start < v_now - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    -- Seconds until this bucket's window rolls over, floored at 1 so a
    -- Retry-After header is never 0 (which reads as "retry immediately").
    'retry_after', greatest(
      1,
      ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds)) - v_now))::integer
    )
  );
end;
$$;

ALTER FUNCTION "public"."consume_rate_limit"("text", integer, integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("text", integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("text", integer, integer) TO "service_role";


-- ============================================================
-- Daily trend series.
-- ============================================================
--
-- generate_series drives the output, not the data: a day with no signups has
-- to come back as a zero, or the chart silently closes the gap and a dead week
-- looks like a flat one.
--
-- Everything is bucketed in Asia/Taipei, the only timezone the numbers are
-- ever read in. Bucketing in UTC would put an 07:00 local signup on the
-- previous day and make "today" look empty every morning.
CREATE OR REPLACE FUNCTION "public"."admin_console_trends"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with bounds as (
    select
      least(greatest(coalesce(p_days, 30), 1), 180) as days
  ),
  days as (
    select generate_series(
      (timezone('Asia/Taipei', now()))::date - ((select days from bounds) - 1),
      (timezone('Asia/Taipei', now()))::date,
      interval '1 day'
    )::date as day
  ),
  new_users as (
    select (timezone('Asia/Taipei', created_at))::date as day, count(*) as n
    from users
    where deleted_at is null
    group by 1
  ),
  -- users.updated_at is refreshed on every login upsert, so it doubles as a
  -- "last seen" timestamp - the same proxy admin_console_overview uses.
  active_users as (
    select (timezone('Asia/Taipei', updated_at))::date as day, count(*) as n
    from users
    where deleted_at is null
    group by 1
  ),
  new_groups as (
    select (timezone('Asia/Taipei', created_at))::date as day, count(*) as n
    from groups
    where deleted_at is null
    group by 1
  ),
  new_expenses as (
    select (timezone('Asia/Taipei', created_at))::date as day, count(*) as n
    from expenses
    where deleted_at is null
    group by 1
  )
  select jsonb_build_object(
    'days', (select days from bounds),
    'points', coalesce((
      select jsonb_agg(to_jsonb(point.*) order by point.day)
      from (
        select
          d.day::text as day,
          coalesce(nu.n, 0)::int as new_users,
          coalesce(au.n, 0)::int as active_users,
          coalesce(ng.n, 0)::int as new_groups,
          coalesce(ne.n, 0)::int as expenses
        from days d
        left join new_users nu on nu.day = d.day
        left join active_users au on au.day = d.day
        left join new_groups ng on ng.day = d.day
        left join new_expenses ne on ne.day = d.day
      ) point
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_trends"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_trends"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_trends"("p_days" integer) TO "service_role";


-- ============================================================
-- Operations health.
-- ============================================================
CREATE OR REPLACE FUNCTION "public"."admin_console_health"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'backup', (
      select jsonb_build_object(
        'last_success_at', last_success_at,
        'detail', detail
      )
      from ops_heartbeats where kind = 'db_backup'
    ),
    'rate_limit', jsonb_build_object(
      -- Buckets still inside a live window: how much traffic is being counted
      -- right now, not since the beginning of time.
      'active_buckets', (
        select count(*) from api_rate_limits where window_start > now() - interval '1 hour'
      ),
      'blocked_24h', (
        select coalesce(sum(blocked_count), 0)::int from api_rate_limits
        where window_start > now() - interval '24 hours'
      )
    ),
    'errors', jsonb_build_object(
      'last_24h', (select count(*) from app_error_logs where created_at > now() - interval '24 hours'),
      'last_7d', (select count(*) from app_error_logs where created_at > now() - interval '7 days'),
      'latest_at', (select max(created_at) from app_error_logs)
    ),
    'feedback', jsonb_build_object(
      -- Unread feedback is an ops signal too: it is the other inbox that goes
      -- unwatched, and it sits one click away in the same console.
      'open', (select count(*) from app_feedback where status = 'new')
    )
  );
$$;

ALTER FUNCTION "public"."admin_console_health"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_health"() TO "service_role";
