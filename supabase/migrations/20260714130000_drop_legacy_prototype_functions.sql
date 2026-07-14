-- Drop the 14 prototype RPCs that outlived the prototype.
--
-- They were the pre-MVP app's entire API surface: the browser called them
-- directly with the anon key. The MVP replaced that with a server that talks to
-- Postgres as service_role, 20260630003000 revoked anon/authenticated EXECUTE on
-- them, and 20260711230000 dropped the prototype tables five of them were
-- written against - so those five cannot run at all any more:
--
--   accept_group_invite, create_group_invite       -> group_invites (dropped)
--   get_admin_dashboard                            -> user_snapshots, settlement_statuses (dropped)
--   get_my_cloud_data, sync_group_member_deletions -> settlement_statuses (dropped)
--
-- The other nine still reference live tables, which is exactly why they should
-- not be left lying around: they are SECURITY DEFINER, service_role-executable,
-- and they write to groups/group_members/expenses/profiles under the prototype's
-- rules rather than the MVP's.
--
-- Verified before dropping: zero references across apps/, api/, vercel-api/ and
-- scripts/, zero triggers, and zero dependent objects in pg_depend.
--
-- ---------------------------------------------------------------------------
-- is_group_member() IS DELIBERATELY NOT IN THIS LIST.
--
-- It looks like one of them - same prototype vintage, same file, and nothing in
-- the application calls it either. It is not. Nine live RLS policies are built
-- on it:
--
--   groups_select_member_or_owner                        on groups
--   members_select_group_member                          on group_members
--   expenses_{select,insert,update,delete}_group_member  on expenses
--   settlements_{select,insert,update}_group_member      on settlements
--
-- and those policies are load-bearing. `authenticated` still holds
-- SELECT/INSERT/UPDATE on all four tables, and the browser carries a real
-- Supabase JWT (the login is Supabase OAuth), so they are the only thing standing
-- between a logged-in user and direct PostgREST access to the raw tables.
-- Dropping the function CASCADEs every one of those policies away with it.
--
-- The first version of this migration did include it. Postgres refused to run,
-- which is the only reason it was caught. Leave it alone.
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in (
      'accept_group_invite', 'create_group_invite', 'ensure_profile', 'get_admin_dashboard',
      'get_my_cloud_data', 'record_admin_audit', 'record_app_error', 'record_user_feedback',
      'sync_group_expense_deletions', 'sync_group_member_deletions', 'sync_owned_group_deletions',
      'upsert_group_expense', 'upsert_group_member', 'upsert_owned_group'
    )
  loop
    execute format('drop function if exists %s', fn.sig);
  end loop;
end $$;
