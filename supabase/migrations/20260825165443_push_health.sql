-- Make push failure visible, because its failure mode is silence.
--
-- Every other subsystem tells you when it breaks: a failed write is a 500, a
-- broken scan is a 503, a stale backup is a red tile. Push does none of that.
-- A wrong VAPID key, an expired subscription, a browser that quietly stopped
-- honouring the endpoint — every one of them looks exactly like "nobody
-- happened to record an expense today". deliverPush has always returned
-- {sent, pruned, failed} and every caller has thrown it away.
--
-- This matters more since error alerting shipped: those alerts ARE pushes, so
-- a silent push failure now takes the alerting with it. The one number this is
-- really for is subscribed_admins — alerting that can reach nobody is worse
-- than no alerting, because it looks like everything is fine.


-- ============================================================
-- One row per fan-out, not per endpoint.
-- ============================================================
--
-- A single expense notifies everyone else in the group, so per-endpoint rows
-- would multiply by group size for no extra signal: what is worth knowing is
-- "this notification reached 4 of 5 devices", and that is one row.
CREATE TABLE IF NOT EXISTS "public"."push_delivery_logs" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  -- expense | nudge | member_joined | error_alert
  "kind" "text" NOT NULL,
  "sent" integer DEFAULT 0 NOT NULL,
  -- Endpoints the push service said are gone (404/410); deleted, not retried.
  -- A steady trickle is normal (people reinstall); a spike is not.
  "pruned" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "push_delivery_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."push_delivery_logs" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "push_delivery_logs_created_idx"
  ON "public"."push_delivery_logs" USING "btree" ("created_at" DESC);

ALTER TABLE "public"."push_delivery_logs" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."push_delivery_logs" TO "service_role";


CREATE OR REPLACE FUNCTION "public"."log_push_delivery"(
  "p_kind" "text",
  "p_sent" integer,
  "p_pruned" integer,
  "p_failed" integer
) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into push_delivery_logs (kind, sent, pruned, failed)
  values (
    coalesce(nullif(p_kind, ''), 'unknown'),
    greatest(coalesce(p_sent, 0), 0),
    greatest(coalesce(p_pruned, 0), 0),
    greatest(coalesce(p_failed, 0), 0)
  );
$$;

ALTER FUNCTION "public"."log_push_delivery"("text", integer, integer, integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."log_push_delivery"("text", integer, integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_push_delivery"("text", integer, integer, integer) TO "service_role";


CREATE OR REPLACE FUNCTION "public"."purge_push_delivery_logs"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted bigint;
begin
  delete from push_delivery_logs
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30));

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

ALTER FUNCTION "public"."purge_push_delivery_logs"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."purge_push_delivery_logs"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_push_delivery_logs"("p_days" integer) TO "service_role";


-- ============================================================
-- The console's read.
-- ============================================================
--
-- Live definition (pg_get_functiondef) with one key added; the applied result
-- is diffed against the previous one to prove nothing else moved.
CREATE OR REPLACE FUNCTION "public"."admin_console_health"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $function$
  select jsonb_build_object(
    'backup', (
      select jsonb_build_object(
        'last_success_at', last_success_at,
        'detail', detail
      )
      from ops_heartbeats where kind = 'db_backup'
    ),
    -- Every heartbeat, including db_backup. The console decides which ones it
    -- expects and how stale is too stale, so adding a job later needs no
    -- migration.
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', kind,
        'last_success_at', last_success_at,
        'detail', detail
      ) order by kind)
      from ops_heartbeats
    ), '[]'::jsonb),
    'push', jsonb_build_object(
      'subscriptions', (select count(*) from push_subscriptions),
      'subscribed_users', (select count(distinct user_id) from push_subscriptions),
      -- The pair that says whether error alerting can reach anybody. Alerting
      -- with no reachable operator looks exactly like a quiet week.
      'admins', (select count(*) from app_admins where role in ('owner', 'admin')),
      'subscribed_admins', (
        select count(distinct a.user_id)
        from app_admins a
        join push_subscriptions s on s.user_id = a.user_id
        where a.role in ('owner', 'admin')
      ),
      'sent_7d', (
        select coalesce(sum(sent), 0)::int from push_delivery_logs
        where created_at > now() - interval '7 days'
      ),
      'failed_7d', (
        select coalesce(sum(failed), 0)::int from push_delivery_logs
        where created_at > now() - interval '7 days'
      ),
      'pruned_7d', (
        select coalesce(sum(pruned), 0)::int from push_delivery_logs
        where created_at > now() - interval '7 days'
      ),
      'last_delivery_at', (select max(created_at) from push_delivery_logs)
    ),
    'rate_limit', jsonb_build_object(
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
      'latest_at', (select max(created_at) from app_error_logs),
      'open_groups', (
        select count(*)
        from (
          select error_log_fingerprint(e.message, e.source) as fingerprint
          from app_error_logs e
          where e.created_at > now() - interval '30 days'
          group by 1
        ) g
        left join app_error_group_status s on s.fingerprint = g.fingerprint
        where coalesce(s.status, 'open') = 'open'
      )
    ),
    'feedback', jsonb_build_object(
      'open', (select count(*) from app_feedback where status = 'new')
    )
  );
$function$;

ALTER FUNCTION "public"."admin_console_health"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_health"() TO "service_role";
