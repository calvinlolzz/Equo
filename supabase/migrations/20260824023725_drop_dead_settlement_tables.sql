-- Drop the settlement tables nothing writes, and the audit table nothing ever
-- wrote at all.
--
-- The API half of this went in the commit before: POST .../settlement/calculate
-- and .../confirm, plus their repository, had no caller anywhere in the app
-- since 2026-07-05 (f995d12, a dead-code purge). What is left behind in the
-- database is the storage those endpoints wrote to:
--
--   settlements           9 rows, every one status='draft', newest 2026-07-02
--   settlement_transfers  0 rows
--   audit_logs            0 rows, and no code has ever referenced it
--
-- 清償 in the shipped app is a kind='settlement' expense written through
-- create_expense — a completely separate path that this migration does not
-- touch. These three tables are the abandoned first design.
--
-- What goes with them, checked against pg_constraint / pg_policy / pg_proc
-- rather than grep:
--   * 7 RLS policies (3 + 2 + 2), dropped with their tables.
--   * ~10 indexes, likewise.
--   * create_settlement(), whose only caller was the deleted repository.
--   * NO inbound foreign keys — nothing outside the trio points at them.
--
-- Two side benefits worth naming, because they make a hard path simpler:
--   * settlements and settlement_transfers both held ON DELETE RESTRICT
--     references to group_members. That is two fewer of the six tables that
--     make deleting an account an ordering puzzle (see delete_my_account).
--   * is_group_member() loses 3 of its 9 dependent policies.


-- ============================================================
-- The RPC first: it writes to both settlement tables.
-- ============================================================
DROP FUNCTION IF EXISTS "public"."create_settlement"(
  "uuid", "uuid", integer, integer, "jsonb"
);


-- ============================================================
-- The tables. Child before parent (settlement_transfers.settlement_id).
-- ============================================================
DROP TABLE IF EXISTS "public"."settlement_transfers";
DROP TABLE IF EXISTS "public"."settlements";
DROP TABLE IF EXISTS "public"."audit_logs";


-- ============================================================
-- Account deletion no longer has to know about any of them.
-- ============================================================
--
-- This body is the LIVE definition (pg_get_functiondef, not the 20260725100000
-- migration text, which has drifted) with exactly four statements removed:
--
--   - delete from settlements where group_id = any(v_solo_group_ids)
--   - delete from audit_logs  where group_id = any(v_solo_group_ids)
--   - update settlements set from_user_id = null where from_user_id = p_user
--   - update settlements set to_user_id   = null where to_user_id   = p_user
--
-- Everything else is byte-identical, including the last-admin-owner guard, the
-- owner-reassignment ordering, the anonymise-don't-delete treatment of
-- group_members, and the return shape. The applied result is diffed against the
-- previous definition to prove that.
CREATE OR REPLACE FUNCTION "public"."delete_my_account"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $function$
declare
  v_group record;
  v_new_owner record;
  v_solo_group_ids uuid[] := '{}';
  v_reassigned int := 0;
  v_deleted_groups int := 0;
  v_memberships int := 0;
begin
  -- Never orphan the admin console: refuse if this is its last owner. Deleting
  -- the auth user would cascade-remove the last app_admins owner row and leave
  -- /admin with no one able to manage it. The account holder must hand console
  -- ownership over first. (Only ever trips for the handful of console owners.)
  if exists (select 1 from app_admins where user_id = p_user and role = 'owner')
     and (select count(*) from app_admins where role = 'owner') <= 1 then
    return jsonb_build_object('ok', false, 'reason', 'last_admin_owner');
  end if;

  -- Owned groups: hand each to another real member if one exists (preferring an
  -- active, longest-standing member), otherwise mark it as the user's own to be
  -- hard-deleted below.
  for v_group in select id from groups where owner_id = p_user loop
    select gm.id as member_id, gm.user_id
      into v_new_owner
      from group_members gm
     where gm.group_id = v_group.id
       and gm.user_id is not null
       and gm.user_id <> p_user
     order by (gm.status = 'active') desc, gm.joined_at asc
     limit 1;

    if v_new_owner.member_id is not null then
      update groups
         set owner_id = v_new_owner.user_id,
             owner_member_id = v_new_owner.member_id,
             updated_at = now()
       where id = v_group.id;
      update group_members
         set role = 'owner', status = 'active', updated_at = now()
       where id = v_new_owner.member_id;
      v_reassigned := v_reassigned + 1;
    else
      v_solo_group_ids := array_append(v_solo_group_ids, v_group.id);
    end if;
  end loop;

  -- The user's own private groups: delete children before the member rows so
  -- the RESTRICT references (expense_*/expenses -> group_members) are already
  -- gone by the time the members are removed.
  if array_length(v_solo_group_ids, 1) is not null then
    delete from expenses where group_id = any(v_solo_group_ids);              -- cascades expense_shares / expense_payments
    delete from invites where group_id = any(v_solo_group_ids);
    -- group_member_balances is a VIEW derived from the expense rows above, not
    -- a table — deleting the expenses is what clears it. (Deleting from it
    -- directly is an error.)
    delete from client_requests where group_id = any(v_solo_group_ids);
    delete from group_members where group_id = any(v_solo_group_ids);
    delete from groups where id = any(v_solo_group_ids);
    v_deleted_groups := array_length(v_solo_group_ids, 1);
  end if;

  -- Legacy per-user columns on shared rows are NO ACTION FKs to profiles and
  -- would block the profile delete. The real ledger keys off member ids, so
  -- nulling these moves no money.
  update expenses set payer_id = null where payer_id = p_user;
  update expenses set created_by = null where created_by = p_user;

  -- Detach every remaining membership and strip the personal fields. The member
  -- row survives (RESTRICT-referenced by the ledger) as an anonymous, ownerless
  -- placeholder so other members' balances are untouched. Demoted to 'member'
  -- so a reassigned group never shows two owners.
  update group_members
     set user_id = null,
         role = 'member',
         display_name = '已刪除的使用者',
         initial = null,
         avatar = null,
         avatar_color = null,
         photo_url = null,
         claimed_at = null,
         updated_at = now()
   where user_id = p_user;
  get diagnostics v_memberships = row_count;

  -- The identity itself. Cascades: public.users + public.profiles (PII gone),
  -- auth.identities (Google link severed -> fresh re-login), auth.sessions
  -- (logged out everywhere), app_admins. Everything that referenced the profile
  -- has been detached or deleted above, so nothing blocks it.
  delete from auth.users where id = p_user;

  return jsonb_build_object(
    'ok', true,
    'groups_reassigned', v_reassigned,
    'groups_deleted', v_deleted_groups,
    'memberships_anonymized', v_memberships
  );
end
$function$;

ALTER FUNCTION "public"."delete_my_account"("uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."delete_my_account"("uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_my_account"("uuid") TO "service_role";
