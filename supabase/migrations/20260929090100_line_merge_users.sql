-- Patch admin_console_merge_users: a LINE link is per Equo account, and the
-- source account is disabled by the merge, so its link must not keep
-- recording into an account nobody can sign into anymore.
--
-- Decision: delete the source's link rather than move it to the target. This
-- follows the push_subscriptions precedent right above the anchor (a merged
-- account's live endpoints are deleted, not reassigned), and it avoids binding
-- a LINE identity to an Equo account that never went through LINE's own
-- account-link verification for that pairing.
--
-- Anchor-and-hit-count patch, same pattern as
-- 20260922090000_personal_ledger.sql:211-240 - this function is well over a
-- hundred lines and the change is two statements.

DO $patch$
declare
  v_anchor constant text := $anchor$delete from push_subscriptions where user_id = p_source_user_id;$anchor$;
  v_replacement constant text := $repl$delete from push_subscriptions where user_id = p_source_user_id;

  -- A LINE link is per account; the retired account is disabled, so its link
  -- must not keep recording into it.
  delete from line_accounts where user_id = p_source_user_id;
  delete from line_link_requests where user_id = p_source_user_id;$repl$;
  v_def text;
  v_hits integer;
begin
  v_def := pg_get_functiondef('public.admin_console_merge_users'::regproc);

  if position('delete from line_accounts' in v_def) > 0 then
    raise notice 'admin_console_merge_users already patched, skipping';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'anchor appears % times in admin_console_merge_users (expected 1)', v_hits;
  end if;

  execute replace(v_def, v_anchor, v_replacement);

  v_def := pg_get_functiondef('public.admin_console_merge_users'::regproc);
  if position('delete from line_accounts' in v_def) = 0 then
    raise exception 'patch did not land in admin_console_merge_users';
  end if;
end
$patch$;
