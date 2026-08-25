-- Surface 循環支出 rules that have silently switched themselves off.
--
-- materialise_recurring_expenses deactivates a rule that raises, storing the
-- reason in last_error (usually the payer or a sharer having left the group).
-- The rule's owner sees that in their own panel, so the user-facing half is
-- covered — what nobody can see is the cross-group view. The heartbeat added
-- with the per-job hearbeats reports "2 條規則失敗" and stops there: an
-- operator cannot find out WHICH rules, in which groups, or why.
--
-- Deliberately NOT a new tab or a new endpoint. This rides on the health
-- payload the overview already fetches, and renders nothing at all on a good
-- day — the same rule the inbox follows. The feature has zero rules in
-- production today, so a whole console surface for it would be building for an
-- imagined operator rather than a real one.
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
    'recurring', jsonb_build_object(
      'rules', (select count(*) from recurring_expenses),
      'active', (select count(*) from recurring_expenses where active),
      -- A rule the nightly job switched off. Counted separately from merely
      -- inactive, because a user pausing their own rule is not a fault.
      'broken', (select count(*) from recurring_expenses where last_error is not null),
      -- Capped: this rides on a payload the overview polls, and ten broken
      -- rules is already a systemic problem rather than a list to work through.
      'broken_rules', coalesce((
        select jsonb_agg(to_jsonb(entry.*) order by entry.last_run_at desc nulls last)
        from (
          select
            r.id::text as id,
            r.title,
            r.group_id::text as group_id,
            g.name as group_name,
            r.last_error,
            r.last_run_at,
            r.active
          from recurring_expenses r
          left join groups g on g.id = r.group_id
          where r.last_error is not null
          order by r.last_run_at desc nulls last
          limit 10
        ) entry
      ), '[]'::jsonb)
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
