-- Self-service account deletion.
--
-- There was no way for a user to delete their own account and data - only an
-- admin could disable one (users.deleted_at). GDPR's right to erasure and both
-- app stores' "must offer in-app account deletion" rules make this a hard
-- launch blocker.
--
-- The hard part is that a person is entangled in OTHER people's financial
-- records. The ledger is anchored to member ids (group_members.id), never to
-- the user account, and group_members is RESTRICT-referenced by six ledger
-- tables - so a member row that has any activity CANNOT be deleted without
-- corrupting the group's math for everyone else. The design therefore:
--
--   * DETACHES the person from their membership rows (user_id -> null) and
--     anonymises the personal fields, leaving the member as an unclaimed
--     placeholder. Every expense/share/payment/settlement still references the
--     same member id, so no one else's balance moves.
--   * REASSIGNS ownership of shared groups the person owned to another real
--     member (the app never leaves a group ownerless while people are in it).
--   * HARD-DELETES groups that were the person's own (no other real member) -
--     that data is theirs alone - children first so the member RESTRICT
--     references are gone before the member rows.
--   * Finally deletes the auth user, cascading public.users + public.profiles
--     (erasing the PII) and auth.identities (severing the Google link, so a
--     later sign-in with the same Google account starts a brand-new account)
--     and auth.sessions (immediate logout everywhere).
--
-- Runs as one function body (one transaction): a failure part-way rolls the
-- whole thing back rather than leaving a half-deleted account.

CREATE OR REPLACE FUNCTION "public"."delete_my_account"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  -- the RESTRICT references (settlement_transfers/expense_*/settlements/expenses
  -- -> group_members) are already gone by the time the members are removed.
  if array_length(v_solo_group_ids, 1) is not null then
    delete from settlements where group_id = any(v_solo_group_ids);           -- cascades settlement_transfers
    delete from expenses where group_id = any(v_solo_group_ids);              -- cascades expense_shares / expense_payments
    delete from invites where group_id = any(v_solo_group_ids);
    -- group_member_balances is a VIEW derived from the expense rows above, not
    -- a table — deleting the expenses is what clears it. (Deleting from it
    -- directly is an error.)
    delete from audit_logs where group_id = any(v_solo_group_ids);
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
  update settlements set from_user_id = null where from_user_id = p_user;
  update settlements set to_user_id = null where to_user_id = p_user;

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
$$;

ALTER FUNCTION "public"."delete_my_account"("uuid") OWNER TO "postgres";

-- PostgREST exposes functions at /rest/v1/rpc/ and PUBLIC can execute by
-- default. This one deletes an account - only the API's service role may call
-- it, and only ever for the caller's own id (enforced in the route handler).
REVOKE ALL ON FUNCTION "public"."delete_my_account"("uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_my_account"("uuid") TO "service_role";
