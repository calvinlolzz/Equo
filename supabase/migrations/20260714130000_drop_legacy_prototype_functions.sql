-- Drop the 15 prototype RPCs that outlived the prototype.
--
-- These were the entire API surface of the pre-MVP app: the browser called them
-- directly with the anon key. The MVP replaced that with a server that talks to
-- Postgres as service_role, 20260630003000 revoked anon/authenticated EXECUTE on
-- them, and 20260711230000 dropped the prototype tables they were written
-- against. What was left is a set of functions that nothing calls and that, in
-- five cases, could not run at all any more:
--
--   accept_group_invite, create_group_invite      -> group_invites (dropped)
--   get_admin_dashboard                           -> user_snapshots, settlement_statuses (dropped)
--   get_my_cloud_data, sync_group_member_deletions-> settlement_statuses (dropped)
--
-- The other ten still reference live tables, which is precisely why they should
-- not be left lying around: they are SECURITY DEFINER, service_role-executable,
-- and they write to groups/group_members/expenses/profiles with the prototype's
-- rules rather than the MVP's. Nothing invokes them (verified: zero references
-- across apps/, api/, vercel-api/, scripts/; zero triggers bound to any of them).
--
-- Their definitions are not lost - they live in git history at
-- supabase/schema.sql, which this change removes in the same commit, and which
-- was their only home.

drop function if exists public.accept_group_invite(text);
drop function if exists public.create_group_invite(uuid, text, text);
drop function if exists public.ensure_profile();
drop function if exists public.get_admin_dashboard();
drop function if exists public.get_my_cloud_data();
drop function if exists public.is_group_member(uuid, uuid);
drop function if exists public.record_admin_audit(text, jsonb);
drop function if exists public.record_app_error(text, text, text, text);
drop function if exists public.record_user_feedback(text, text, text, text);
drop function if exists public.sync_group_expense_deletions(uuid, text[]);
drop function if exists public.sync_group_member_deletions(uuid, text[]);
drop function if exists public.sync_owned_group_deletions(text[]);
drop function if exists public.upsert_group_expense(uuid, jsonb);
drop function if exists public.upsert_group_member(uuid, jsonb);
drop function if exists public.upsert_owned_group(jsonb);

-- Signatures above are best-effort; catch any overload the explicit drops miss
-- (these functions were only ever defined in schema.sql, so the name is enough
-- to identify them unambiguously).
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
      'get_my_cloud_data', 'is_group_member', 'record_admin_audit', 'record_app_error',
      'record_user_feedback', 'sync_group_expense_deletions', 'sync_group_member_deletions',
      'sync_owned_group_deletions', 'upsert_group_expense', 'upsert_group_member',
      'upsert_owned_group'
    )
  loop
    execute format('drop function if exists %s', fn.sig);
  end loop;
end $$;
