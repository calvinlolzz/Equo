-- Admin console: the writes support actually needs.
--
-- Until now the console could look at everything and change almost nothing: a
-- user could be disabled, a group archived or soft-deleted, and that was the
-- whole vocabulary. Every other support request - "this expense is a duplicate",
-- "the group owner left the company", "I signed in with the wrong Google
-- account and now I'm two people", "delete my account for me", "send me my
-- data" - ended with somebody opening a SQL client against production. That is
-- the thing this migration exists to stop.
--
-- Each action follows the house rules the earlier admin_console_* functions
-- set: SECURITY DEFINER with a pinned search_path, service_role-only EXECUTE,
-- the audit row written in the same transaction as the change it records, and
-- "row not found" expressed as a NULL return rather than an exception so the
-- handler can answer 404 without parsing an error string.

-- ---------------------------------------------------------------------------
-- Expenses: soft-delete/restore, and correcting the descriptive fields.
-- ---------------------------------------------------------------------------

-- Soft-delete or restore one expense.
--
-- Deliberately NOT soft_delete_expense: that one is the member-facing path and
-- insists the caller is an active member of the group, which an admin is not.
-- It also has no restore, and restoring is the more common support action -
-- somebody deleted the wrong row and wants it back.
--
-- version is bumped on both directions for the same reason the member path
-- bumps it: a client holding the old row must lose the optimistic-concurrency
-- race rather than quietly write over what the admin just did.
CREATE OR REPLACE FUNCTION "public"."admin_console_set_expense_deleted"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_group_id" "uuid",
  "p_expense_id" "uuid",
  "p_deleted" boolean
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row expenses%rowtype;
begin
  update expenses
  set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end,
      version = version + 1,
      updated_at = now()
  where id = p_expense_id
    and group_id = p_group_id
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    case when p_deleted then 'expense.delete' else 'expense.restore' end,
    jsonb_build_object(
      'group_id', v_row.group_id,
      'expense_id', v_row.id,
      'title', v_row.title,
      'amount_minor', v_row.amount_minor,
      'currency', v_row.currency
    )
  );

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'category', v_row.category,
    'expense_date', v_row.expense_date,
    'note', v_row.note,
    'deleted_at', v_row.deleted_at,
    'version', v_row.version
  );
end
$$;

ALTER FUNCTION "public"."admin_console_set_expense_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_expense_id" "uuid", "p_deleted" boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_set_expense_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_expense_id" "uuid", "p_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_expense_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_expense_id" "uuid", "p_deleted" boolean) TO "service_role";

-- Correct an expense's descriptive fields: title, category, date, note.
--
-- Money is NOT editable here, and that is the whole design of this function.
-- Amounts, payers and shares are a linked set - changing one without the others
-- silently unbalances the group for everyone in it, and getting them right
-- means reproducing the composer's arithmetic in the console. A support person
-- fixing a typo or a mis-filed category needs none of that; a genuinely wrong
-- amount belongs back with the member who entered it (or with a delete and a
-- re-entry, which this migration also makes possible).
--
-- Every parameter is optional in the "pass NULL to leave alone" sense, except
-- note, where NULL is a legitimate value - so note is cleared by passing the
-- empty string and left alone by passing NULL.
CREATE OR REPLACE FUNCTION "public"."admin_console_update_expense_meta"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_group_id" "uuid",
  "p_expense_id" "uuid",
  "p_title" "text",
  "p_category" "text",
  "p_expense_date" "date",
  "p_note" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_before expenses%rowtype;
  v_row expenses%rowtype;
  v_changed jsonb := '{}'::jsonb;
begin
  select * into v_before from expenses where id = p_expense_id and group_id = p_group_id;

  if v_before.id is null then
    return null;
  end if;

  update expenses
  set title = coalesce(nullif(btrim(p_title), ''), title),
      category = coalesce(nullif(btrim(p_category), ''), category),
      expense_date = coalesce(p_expense_date, expense_date),
      note = case when p_note is null then note else nullif(btrim(p_note), '') end,
      version = version + 1,
      updated_at = now()
  where id = p_expense_id
    and group_id = p_group_id
  returning * into v_row;

  -- The audit row records the before/after of what actually moved rather than
  -- the whole payload: "who changed the category on this expense, and from
  -- what" is the question the log gets asked, and a diff answers it directly.
  if v_row.title is distinct from v_before.title then
    v_changed := v_changed || jsonb_build_object('title', jsonb_build_array(v_before.title, v_row.title));
  end if;
  if v_row.category is distinct from v_before.category then
    v_changed := v_changed || jsonb_build_object('category', jsonb_build_array(v_before.category, v_row.category));
  end if;
  if v_row.expense_date is distinct from v_before.expense_date then
    v_changed := v_changed || jsonb_build_object('expense_date', jsonb_build_array(v_before.expense_date, v_row.expense_date));
  end if;
  if v_row.note is distinct from v_before.note then
    v_changed := v_changed || jsonb_build_object('note', jsonb_build_array(v_before.note, v_row.note));
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'expense.update',
    jsonb_build_object('group_id', v_row.group_id, 'expense_id', v_row.id, 'changed', v_changed)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'category', v_row.category,
    'expense_date', v_row.expense_date,
    'note', v_row.note,
    'deleted_at', v_row.deleted_at,
    'version', v_row.version
  );
end
$$;

ALTER FUNCTION "public"."admin_console_update_expense_meta"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_expense_id" "uuid", "p_title" "text", "p_category" "text", "p_expense_date" "date", "p_note" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_update_expense_meta"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_expense_id" "uuid", "p_title" "text", "p_category" "text", "p_expense_date" "date", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_update_expense_meta"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_expense_id" "uuid", "p_title" "text", "p_category" "text", "p_expense_date" "date", "p_note" "text") TO "service_role";

-- ---------------------------------------------------------------------------
-- Groups: hand ownership to another member.
-- ---------------------------------------------------------------------------

-- Move a group's ownership to one of its members.
--
-- The app has no way to do this: ownership is set at creation and only ever
-- moves during account deletion. So "the person who made the group left" is
-- currently a permanent state, and it matters because owner-only actions
-- (renaming, deleting, removing members) become unreachable for the people
-- still using the group.
--
-- Ownership lives in two places that have to agree - groups.owner_id/
-- owner_member_id and the member row's role - which is exactly why this is one
-- function and not three console requests. Any previous owner rows are demoted
-- in the same statement, so a group can never come out of this with two.
CREATE OR REPLACE FUNCTION "public"."admin_console_transfer_group_owner"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_group_id" "uuid",
  "p_member_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_group groups%rowtype;
  v_member group_members%rowtype;
  v_previous_member_id uuid;
begin
  select * into v_group from groups where id = p_group_id;

  if v_group.id is null then
    return jsonb_build_object('ok', false, 'error', 'GROUP_NOT_FOUND');
  end if;

  select * into v_member
  from group_members
  where id = p_member_id
    and group_id = p_group_id;

  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'MEMBER_NOT_FOUND');
  end if;

  -- A member added by name and never claimed by a login has no account behind
  -- it, so it cannot hold owner-only permissions - groups.owner_id is NOT NULL
  -- and is what the app authorises against.
  if v_member.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'MEMBER_NOT_CLAIMED');
  end if;

  v_previous_member_id := v_group.owner_member_id;

  update group_members
  set role = 'member', updated_at = now()
  where group_id = p_group_id
    and role = 'owner'
    and id <> v_member.id;

  update group_members
  set role = 'owner', status = 'active', updated_at = now()
  where id = v_member.id;

  update groups
  set owner_id = v_member.user_id,
      owner_member_id = v_member.id,
      updated_at = now()
  where id = p_group_id;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'group.transfer_owner',
    jsonb_build_object(
      'group_id', p_group_id,
      'name', v_group.name,
      'from_member_id', v_previous_member_id,
      'to_member_id', v_member.id,
      'to_user_id', v_member.user_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'group_id', p_group_id,
    'owner_member_id', v_member.id,
    'owner_user_id', v_member.user_id,
    'owner_display_name', v_member.display_name
  );
end
$$;

ALTER FUNCTION "public"."admin_console_transfer_group_owner"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_member_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_transfer_group_owner"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_transfer_group_owner"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_member_id" "uuid") TO "service_role";

-- ---------------------------------------------------------------------------
-- Users: merge duplicates, export, delete.
-- ---------------------------------------------------------------------------

-- Fold one account's memberships into another and retire the duplicate.
--
-- The case this exists for: one person, two accounts, because the second login
-- went through a different Google account. Their groups are split across the
-- two and neither shows the whole picture.
--
-- What makes this safe is that the ledger is anchored to group_members.id, not
-- to the user account (the same property account deletion relies on). Moving a
-- membership to another account therefore moves no money: every expense, share,
-- payment and settlement still points at the same member row.
--
-- It REFUSES when both accounts hold membership rows in the same group, and
-- that refusal is the important part. Merging there would mean merging two
-- member rows - two sets of expenses, shares and balances that both have to
-- survive - which is a re-ledgering operation, not a repointing one. The
-- conflicting groups come back in the error so the console can name them.
CREATE OR REPLACE FUNCTION "public"."admin_console_merge_users"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_source_user_id" "uuid",
  "p_target_user_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_source users%rowtype;
  v_target users%rowtype;
  v_conflicts jsonb;
  v_moved int := 0;
  v_groups_reowned int := 0;
begin
  if p_source_user_id = p_target_user_id then
    return jsonb_build_object('ok', false, 'error', 'SAME_USER');
  end if;

  select * into v_source from users where id = p_source_user_id;
  select * into v_target from users where id = p_target_user_id;

  if v_source.id is null or v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- The account being retired must not be one the console depends on: it ends
  -- this function disabled, and a disabled console owner is a locked console.
  if exists (select 1 from app_admins where user_id = p_source_user_id) then
    return jsonb_build_object('ok', false, 'error', 'SOURCE_IS_ADMIN');
  end if;

  select jsonb_agg(jsonb_build_object('group_id', g.id, 'name', g.name))
    into v_conflicts
  from groups g
  where exists (select 1 from group_members m where m.group_id = g.id and m.user_id = p_source_user_id)
    and exists (select 1 from group_members m where m.group_id = g.id and m.user_id = p_target_user_id);

  if v_conflicts is not null then
    return jsonb_build_object('ok', false, 'error', 'GROUP_OVERLAP', 'groups', v_conflicts);
  end if;

  update group_members
  set user_id = p_target_user_id, updated_at = now()
  where user_id = p_source_user_id;
  get diagnostics v_moved = row_count;

  -- groups.owner_id points at the account, so a group the source account owned
  -- has to follow its membership across or the app would authorise its
  -- owner-only actions against an account that is about to be disabled.
  update groups
  set owner_id = p_target_user_id, updated_at = now()
  where owner_id = p_source_user_id;
  get diagnostics v_groups_reowned = row_count;

  -- Push endpoints are per-device-per-account. The device is still the same
  -- person's, but it is subscribed as the retired account; leaving the rows
  -- would send that person notifications addressed to an identity that can no
  -- longer log in. Re-subscribing under the surviving account is one visit.
  delete from push_subscriptions where user_id = p_source_user_id;

  update users
  set deleted_at = coalesce(deleted_at, now())
  where id = p_source_user_id;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'user.merge',
    jsonb_build_object(
      'source_user_id', p_source_user_id,
      'source_email', v_source.email,
      'target_user_id', p_target_user_id,
      'target_email', v_target.email,
      'memberships_moved', v_moved,
      'groups_reowned', v_groups_reowned
    )
  );

  return jsonb_build_object(
    'ok', true,
    'source_user_id', p_source_user_id,
    'source_email', v_source.email,
    'target_user_id', p_target_user_id,
    'target_email', v_target.email,
    'memberships_moved', v_moved,
    'groups_reowned', v_groups_reowned
  );
end
$$;

ALTER FUNCTION "public"."admin_console_merge_users"("p_actor" "uuid", "p_actor_email" "text", "p_source_user_id" "uuid", "p_target_user_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_merge_users"("p_actor" "uuid", "p_actor_email" "text", "p_source_user_id" "uuid", "p_target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_merge_users"("p_actor" "uuid", "p_actor_email" "text", "p_source_user_id" "uuid", "p_target_user_id" "uuid") TO "service_role";

-- Everything the service holds about one person, as one JSON document.
--
-- The right of access is the half of GDPR the account-deletion work did not
-- cover, and a support person currently answers it by hand. Structured as
-- "their account, their memberships, the expenses they are party to" rather
-- than as a table dump, because the person asking wants to read it.
--
-- The expense list is capped: this is a subject-access response for one person,
-- not a bulk export, and an unbounded array here would be the one query in the
-- console that can pull a whole group's ledger into memory.
CREATE OR REPLACE FUNCTION "public"."admin_console_export_user"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_user_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user users%rowtype;
  v_member_ids uuid[];
  v_result jsonb;
begin
  select * into v_user from users where id = p_user_id;

  if v_user.id is null then
    return null;
  end if;

  select array_agg(id) into v_member_ids from group_members where user_id = p_user_id;
  v_member_ids := coalesce(v_member_ids, '{}'::uuid[]);

  select jsonb_build_object(
    'exported_at', now(),
    'user', jsonb_build_object(
      'id', v_user.id,
      'email', v_user.email,
      'display_name', v_user.display_name,
      'avatar_url', v_user.avatar_url,
      'created_at', v_user.created_at,
      'last_seen_at', v_user.updated_at,
      'disabled_at', v_user.deleted_at
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id', g.id,
        'group_name', g.name,
        'currency', g.currency,
        'member_id', m.id,
        'display_name', m.display_name,
        'role', m.role,
        'status', m.status,
        'joined_at', m.joined_at,
        'archived_at', g.archived_at,
        'deleted_at', g.deleted_at
      ) order by m.joined_at)
      from group_members m
      join groups g on g.id = m.group_id
      where m.user_id = p_user_id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(entry order by entry ->> 'expense_date' desc)
      from (
        select jsonb_build_object(
          'group_id', e.group_id,
          'expense_id', e.id,
          'title', e.title,
          'kind', e.kind,
          'category', e.category,
          'amount_minor', e.amount_minor,
          'currency', e.currency,
          'expense_date', e.expense_date,
          'note', e.note,
          'created_at', e.created_at,
          'deleted_at', e.deleted_at,
          'paid_minor', (
            select coalesce(sum(p.amount_minor), 0)
            from expense_payments p
            where p.expense_id = e.id and p.payer_member_id = any(v_member_ids)
          ),
          'share_minor', (
            select coalesce(sum(s.amount_minor), 0)
            from expense_shares s
            where s.expense_id = e.id and s.member_id = any(v_member_ids)
          )
        ) as entry
        from expenses e
        where e.group_id in (select group_id from group_members where user_id = p_user_id)
          and (
            e.created_by_member_id = any(v_member_ids)
            or exists (select 1 from expense_payments p where p.expense_id = e.id and p.payer_member_id = any(v_member_ids))
            or exists (select 1 from expense_shares s where s.expense_id = e.id and s.member_id = any(v_member_ids))
          )
        order by e.expense_date desc, e.created_at desc
        limit 5000
      ) capped
    ), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'type', f.type,
        'message', f.message,
        'status', f.status,
        'created_at', f.created_at
      ) order by f.created_at)
      from app_feedback f
      where f.user_id = p_user_id
    ), '[]'::jsonb)
  ) into v_result;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'user.export',
    jsonb_build_object('user_id', p_user_id, 'email', v_user.email)
  );

  return v_result;
end
$$;

ALTER FUNCTION "public"."admin_console_export_user"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_export_user"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_export_user"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") TO "service_role";

-- Run account deletion on someone's behalf.
--
-- Deliberately a thin wrapper over delete_my_account rather than a second
-- implementation: that function is where the hard-won rules live (detach
-- memberships instead of deleting them, reassign owned groups, hard-delete
-- solo ones, refuse for the last console owner). A support-side copy would
-- drift from it, and drift here corrupts other people's balances.
--
-- What the wrapper adds is the audit row, and reading the identity BEFORE the
-- deletion - afterwards there is no users row left to name in the log.
CREATE OR REPLACE FUNCTION "public"."admin_console_delete_user"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_user_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user users%rowtype;
  v_result jsonb;
begin
  select * into v_user from users where id = p_user_id;

  if v_user.id is null then
    return null;
  end if;

  v_result := public.delete_my_account(p_user_id);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return v_result;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'user.delete',
    jsonb_build_object(
      'user_id', p_user_id,
      'email', v_user.email,
      'display_name', v_user.display_name,
      'groups_reassigned', v_result -> 'groups_reassigned',
      'groups_deleted', v_result -> 'groups_deleted',
      'memberships_anonymized', v_result -> 'memberships_anonymized'
    )
  );

  return v_result;
end
$$;

ALTER FUNCTION "public"."admin_console_delete_user"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_delete_user"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_delete_user"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") TO "service_role";
