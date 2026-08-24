-- Make every nightly job report for itself, not just the backup.
--
-- The nightly workflow does four things — dump the database, purge what is past
-- retention, and turn due 循環支出 rules into real expenses — but only the dump
-- ever wrote a heartbeat. Two consequences, both of them silent:
--
--   * The steps run in sequence in one job, so a failed dump aborts the run and
--     the recurring materialisation never happens. Somebody's monthly rent
--     simply does not appear, and the only signal is a backup alert about a
--     different thing.
--   * Even when the workflow itself stops firing (GitHub disables scheduled
--     workflows after 60 days of repo inactivity), the console can only say the
--     BACKUP is stale. Nothing says 循環支出 stopped.
--
-- ops_heartbeats already supports this — it is keyed by `kind` and upserted, so
-- the fix is one row per job and a console that knows which rows to expect. The
-- important half is the expectation: a job with NO heartbeat has to read as bad
-- rather than as absent, because "never ran" is exactly the failure that has
-- been invisible.
--
-- Reproduces the live admin_console_health definition (pg_get_functiondef) with
-- one key added; the applied result is diffed against the previous one to prove
-- nothing else moved.
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
    -- expects to see and how stale is too stale; this just reports what is
    -- there, so adding a job later needs no migration.
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', kind,
        'last_success_at', last_success_at,
        'detail', detail
      ) order by kind)
      from ops_heartbeats
    ), '[]'::jsonb),
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
