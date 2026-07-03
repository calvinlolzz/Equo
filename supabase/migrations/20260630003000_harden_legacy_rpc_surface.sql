-- Harden prototype-era RPC and telemetry surfaces that are not used by the Equo MVP API runtime.
-- The new MVP API uses the server-side service role through api/v1/[...path].ts, so these legacy
-- SECURITY DEFINER functions should not remain callable by browser roles.

do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'accept_group_invite',
        'create_group_invite',
        'ensure_profile',
        'get_admin_dashboard',
        'get_my_cloud_data',
        'is_group_member',
        'record_admin_audit',
        'record_app_error',
        'record_user_feedback',
        'rls_auto_enable',
        'sync_group_expense_deletions',
        'sync_group_member_deletions',
        'sync_owned_group_deletions',
        'upsert_group_expense',
        'upsert_group_member',
        'upsert_owned_group'
      )
  loop
    execute format('revoke execute on function %s from public', target_function);
    execute format('revoke execute on function %s from anon', target_function);
    execute format('revoke execute on function %s from authenticated', target_function);
    execute format('grant execute on function %s to service_role', target_function);
  end loop;
end $$;

alter function public.is_group_member(uuid) set search_path = public, pg_temp;

drop policy if exists app_error_logs_deny_all on public.app_error_logs;
create policy app_error_logs_deny_all
  on public.app_error_logs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists app_feedback_deny_all on public.app_feedback;
create policy app_feedback_deny_all
  on public.app_feedback
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
