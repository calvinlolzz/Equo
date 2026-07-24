-- API rate limiting.
--
-- Nothing capped request volume before this. POST /api/v1/errors takes
-- ANONYMOUS reports by design (a crash before login is the one most worth
-- hearing about), so anyone could write unbounded rows into client_errors and
-- burn Supabase storage and egress with a loop and no account. The authenticated
-- endpoints were uncapped too - attributable, but still free to hammer.
--
-- Counters live in Postgres rather than in the function's memory because Vercel
-- runs many short-lived instances: a per-instance counter would give an attacker
-- one full budget per warm instance and reset whenever one recycled. This is the
-- only place all of them can agree.
--
-- Fixed window, not a sliding one: a burst straddling a window boundary can
-- reach 2x the limit for one window. That is the accepted trade - the goal here
-- is to stop unbounded floods, and a fixed window costs one upsert where a
-- sliding log would cost a row per request (exactly the unbounded growth being
-- defended against). Volumetric attacks are Vercel Firewall's job, not this
-- table's.

CREATE TABLE IF NOT EXISTS "public"."api_rate_limits" (
  -- "<rule>:u:<user_id>" or "<rule>:ip:<address>" - built server-side, see
  -- server/http/rateLimit.ts.
  "bucket" "text" NOT NULL,
  "window_start" timestamp with time zone DEFAULT "now"() NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "api_rate_limits_pkey" PRIMARY KEY ("bucket")
);

ALTER TABLE "public"."api_rate_limits" OWNER TO "postgres";

-- No policies, and no grants to anon/authenticated: the API reaches this
-- through service_role only, like every other table since the frontend roles
-- were revoked. RLS on with zero policies is the deny-all that keeps it that
-- way if a grant is ever added by accident.
ALTER TABLE "public"."api_rate_limits" ENABLE ROW LEVEL SECURITY;

-- Supports the opportunistic sweep below; without it the sweep degrades into a
-- full scan of a table that only ever grows.
CREATE INDEX IF NOT EXISTS "api_rate_limits_window_start_idx"
  ON "public"."api_rate_limits" ("window_start");


-- Count one request against a bucket and say whether it may proceed.
--
-- The upsert is the whole point: read-then-write would let two concurrent
-- requests both read count = limit - 1 and both be allowed. Here the counter is
-- incremented (or reset, if the stored window has aged out) inside a single
-- statement, so the row's own lock serialises them.
--
-- Returns jsonb rather than raising, so being over the limit is an ordinary
-- value the caller turns into a 429 - not an exception that would have to be
-- told apart from a real database failure (which must fail OPEN; see the
-- caller).
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

  insert into api_rate_limits as l (bucket, window_start, request_count)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
    set request_count = case
          when l.window_start <= v_now - make_interval(secs => p_window_seconds) then 1
          else l.request_count + 1
        end,
        window_start = case
          when l.window_start <= v_now - make_interval(secs => p_window_seconds) then v_now
          else l.window_start
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

-- Functions are executable by PUBLIC unless told otherwise, and PostgREST
-- exposes them at /rest/v1/rpc/. Left alone, anon could call this directly and
-- run any bucket it could guess up to its limit - locking a user out of the
-- very endpoint the counter exists to protect, and filling the table while
-- doing it. Only the API's role may count.
REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("text", integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("text", integer, integer) TO "service_role";

-- The baseline's ALTER DEFAULT PRIVILEGES already covers a table created by
-- postgres, but state it outright: if the counter cannot be written the
-- limiter fails open and silently stops limiting, which is exactly the kind of
-- failure that should not hinge on a default.
GRANT ALL ON TABLE "public"."api_rate_limits" TO "service_role";
