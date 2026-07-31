-- Health card: count the errors nobody has dealt with yet.
--
-- admin_console_health already reports raw error volume ("312 in the last 7
-- days"), which after the error-grouping migration is the wrong unit: 312
-- occurrences can be one bug or forty, and either way it says nothing about
-- whether anyone has looked. open_groups is the number that belongs on an
-- inbox — distinct errors, still marked unresolved.
--
-- Scoped to the last 30 days on purpose. A group that stopped happening two
-- months ago and was never explicitly resolved is not something to be nagged
-- about every morning; if it comes back, its last_seen moves and it returns to
-- the count on its own.
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
$$;

ALTER FUNCTION "public"."admin_console_health"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_health"() TO "service_role";
