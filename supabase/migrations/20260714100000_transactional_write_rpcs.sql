-- Transactional write RPCs.
--
-- The API talks to Postgres over PostgREST, one HTTP call per statement, with
-- no transaction spanning them. Every multi-statement write was therefore
-- non-atomic:
--
--   * createExpense issued 1 + N + M separate calls (expense, then each
--     payment, then each share). A failure partway through left an expense in
--     the database with an incomplete share set - which silently corrupts every
--     balance in the group, with no compensating write.
--   * "Edit expense" was a client-side delete-then-create across two HTTP
--     requests. If the create failed (offline, validation, a unique-index
--     collision on a retry), the original was already gone. The user's entry
--     just disappeared.
--   * acceptInvite incremented invites.use_count by reading it and writing back
--     an absolute value, so two people redeeming the last seat concurrently
--     both won. It also never checked whether the caller was already a member -
--     and group_members has no unique (group_id, user_id) - so re-using an
--     invite link minted a second member row for the same person, splitting
--     their balance across two member ids.
--   * calculateSettlement inserted the settlement, then its transfers, one call
--     each - a partial failure yields a settlement that under-settles the group.
--
-- These functions move each of those sequences into the database, where they
-- run in a single implicit transaction. They also close the idempotency hole:
-- client_requests has always been written but never read, so a retried create
-- (offline replay, double-tap) collided with the unique index on
-- (group_id, client_request_id) and surfaced as a 500. Every function below
-- consults client_requests first and returns the row the original call created.
--
-- Errors are raised as bare sentinel messages (NOT_A_GROUP_MEMBER,
-- INVALID_MEMBER:<id>, INVITE_EXPIRED, EXPENSE_NOT_FOUND); PostgREST surfaces
-- them in the error body's `message`, and the route layer maps them to the
-- existing API error codes.
--
-- All of these are service_role-only, matching get_group_detail and the
-- admin_console_* family: the browser never holds a Postgres role.

-- ---------------------------------------------------------------------------
-- Shared row -> jsonb shapes (must match the TS record types in
-- server/repositories/expenseRepository.ts and groupRepository.ts).
-- ---------------------------------------------------------------------------

create or replace function public.expense_json(p_expense_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', e.id,
    'group_id', e.group_id,
    'title', e.title,
    'kind', e.kind,
    'category', e.category,
    'amount_minor', e.amount_minor,
    'currency', e.currency,
    'expense_date', e.expense_date,
    'note', e.note,
    'transfer_to_member_id', e.transfer_to_member_id,
    'created_at', e.created_at,
    'version', e.version,
    'client_request_id', e.client_request_id,
    'image_url', e.image_url
  )
  from expenses e
  where e.id = p_expense_id;
$function$;

create or replace function public.group_member_json(p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', m.id,
    'group_id', m.group_id,
    'user_id', m.user_id,
    'display_name', m.display_name,
    'role', m.role,
    'status', m.status
  )
  from group_members m
  where m.id = p_member_id;
$function$;

create or replace function public.group_json(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'currency', g.currency,
    'owner_member_id', g.owner_member_id,
    'cover_image_url', g.cover_image_url
  )
  from groups g
  where g.id = p_group_id;
$function$;

-- ---------------------------------------------------------------------------
-- create_expense: membership gate + cross-group member validation + the
-- expense and all of its payments/shares, atomically. Idempotent on
-- (group_id, client_request_id).
-- ---------------------------------------------------------------------------

create or replace function public.create_expense(
  p_group_id uuid,
  p_user_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id uuid;
  v_client_request_id text := p_payload ->> 'client_request_id';
  v_existing_id uuid;
  v_expense_id uuid;
  v_invalid_member_id uuid;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  -- Idempotent replay: return what the original call created rather than
  -- colliding with expenses' unique (group_id, client_request_id) index.
  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = v_client_request_id;

  if v_existing_id is not null then
    return public.expense_json(v_existing_id);
  end if;

  -- The foreign keys on expense_payments/expense_shares/transfer_to_member_id
  -- reference group_members(id) globally - they do NOT constrain the member to
  -- this group. Verify every referenced id belongs to this group and is active.
  select referenced.member_id into v_invalid_member_id
  from (
    select (payment ->> 'payer_member_id')::uuid as member_id
    from jsonb_array_elements(coalesce(p_payload -> 'expense_payments', '[]'::jsonb)) as payment
    union all
    select (share ->> 'member_id')::uuid
    from jsonb_array_elements(coalesce(p_payload -> 'expense_shares', '[]'::jsonb)) as share
    union all
    select nullif(p_payload ->> 'transfer_to_member_id', '')::uuid
  ) as referenced
  where referenced.member_id is not null
    and not exists (
      select 1
      from group_members gm
      where gm.id = referenced.member_id
        and gm.group_id = p_group_id
        and gm.status = 'active'
    )
  limit 1;

  if v_invalid_member_id is not null then
    raise exception 'INVALID_MEMBER:%', v_invalid_member_id;
  end if;

  insert into expenses (
    group_id,
    created_by_member_id,
    title,
    kind,
    category,
    amount_minor,
    currency,
    expense_date,
    note,
    transfer_to_member_id,
    client_request_id,
    image_url
  )
  values (
    p_group_id,
    v_member_id,
    p_payload ->> 'title',
    p_payload ->> 'kind',
    coalesce(nullif(p_payload ->> 'category', ''), 'other'),
    (p_payload ->> 'amount_minor')::integer,
    coalesce(nullif(p_payload ->> 'currency', ''), 'TWD'),
    coalesce((nullif(p_payload ->> 'expense_date', ''))::date, current_date),
    nullif(p_payload ->> 'note', ''),
    (nullif(p_payload ->> 'transfer_to_member_id', ''))::uuid,
    v_client_request_id,
    nullif(p_payload ->> 'image_url', '')
  )
  returning id into v_expense_id;

  insert into expense_payments (expense_id, payer_member_id, amount_minor, currency)
  select
    v_expense_id,
    (payment ->> 'payer_member_id')::uuid,
    (payment ->> 'amount_minor')::integer,
    coalesce(nullif(payment ->> 'currency', ''), 'TWD')
  from jsonb_array_elements(coalesce(p_payload -> 'expense_payments', '[]'::jsonb)) as payment;

  insert into expense_shares (expense_id, member_id, share_type, share_value, amount_minor)
  select
    v_expense_id,
    (share ->> 'member_id')::uuid,
    share ->> 'share_type',
    (nullif(share ->> 'share_value', ''))::numeric,
    (share ->> 'amount_minor')::integer
  from jsonb_array_elements(coalesce(p_payload -> 'expense_shares', '[]'::jsonb)) as share;

  insert into client_requests (group_id, client_request_id, resource_id)
  values (p_group_id, v_client_request_id, v_expense_id)
  on conflict (group_id, client_request_id) do nothing;

  return public.expense_json(v_expense_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- soft_delete_expense: membership gate + the soft delete, with the version bump
-- the repository SQL always claimed but the PostgREST PATCH never performed.
-- Idempotent: a retried delete returns the row instead of 404ing.
-- ---------------------------------------------------------------------------

create or replace function public.soft_delete_expense(
  p_group_id uuid,
  p_user_id uuid,
  p_expense_id uuid,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id uuid;
  v_existing_id uuid;
  v_deleted_id uuid;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = p_client_request_id;

  if v_existing_id is not null then
    return public.expense_json(v_existing_id);
  end if;

  update expenses
  set deleted_at = now(),
      version = version + 1,
      updated_at = now()
  where group_id = p_group_id
    and id = p_expense_id
    and deleted_at is null
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  insert into client_requests (group_id, client_request_id, resource_id)
  values (p_group_id, p_client_request_id, v_deleted_id)
  on conflict (group_id, client_request_id) do nothing;

  return public.expense_json(v_deleted_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- replace_expense: the atomic edit. The API has no in-place expense update, so
-- an edit is a delete plus a create - but doing that as two HTTP calls from the
-- browser means a failed create leaves the user with nothing. Here both halves
-- share one transaction: if the create raises (INVALID_MEMBER, a constraint,
-- anything), the delete rolls back with it and the original entry survives.
--
-- Returns { expense, previous } - `previous` carries the replaced row's
-- image_url so the route can clean up the orphaned storage object, and is null
-- on an idempotent replay (nothing was replaced this time).
-- ---------------------------------------------------------------------------

create or replace function public.replace_expense(
  p_group_id uuid,
  p_user_id uuid,
  p_expense_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id uuid;
  v_existing_id uuid;
  v_previous jsonb;
  v_deleted_id uuid;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = p_payload ->> 'client_request_id';

  if v_existing_id is not null then
    return jsonb_build_object('expense', public.expense_json(v_existing_id), 'previous', null);
  end if;

  v_previous := public.expense_json(p_expense_id);

  update expenses
  set deleted_at = now(),
      version = version + 1,
      updated_at = now()
  where group_id = p_group_id
    and id = p_expense_id
    and deleted_at is null
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  -- Same transaction: create_expense raising here rolls the delete back too.
  return jsonb_build_object(
    'expense', public.create_expense(p_group_id, p_user_id, p_payload),
    'previous', v_previous
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- accept_invite: validates the invite, joins the caller, and burns one use -
-- all under a row lock on the invite, so concurrent redemptions of the last
-- seat can no longer both succeed.
-- ---------------------------------------------------------------------------

create or replace function public.accept_invite(
  p_token_hash text,
  p_user_id uuid,
  p_display_name text,
  p_claim_member_id uuid,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite invites%rowtype;
  v_member_id uuid;
  v_claimed boolean := false;
begin
  -- for update serialises concurrent accepts of the same invite: without it,
  -- two callers both read use_count = max_uses - 1 and both get in.
  select * into v_invite
  from invites
  where token_hash = p_token_hash
  for update;

  if not found
    or v_invite.revoked_at is not null
    or v_invite.use_count >= v_invite.max_uses
    or (v_invite.expires_at is not null and v_invite.expires_at <= now())
    or not exists (
      select 1 from groups g where g.id = v_invite.group_id and g.deleted_at is null
    )
  then
    raise exception 'INVITE_EXPIRED';
  end if;

  -- Already in the group: hand back the existing membership. Re-running the
  -- join would mint a second member row for the same person (nothing in the
  -- schema forbids it) and split their balance across two member ids. It must
  -- also not burn a use of the invite.
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = v_invite.group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is not null then
    return jsonb_build_object(
      'group', public.group_json(v_invite.group_id),
      'member', public.group_member_json(v_member_id),
      'claimed', false
    );
  end if;

  if p_claim_member_id is not null then
    update group_members
    set user_id = p_user_id,
        display_name = p_display_name,
        claimed_at = now(),
        updated_at = now()
    where id = p_claim_member_id
      and group_id = v_invite.group_id
      and user_id is null
      and status = 'active'
    returning id into v_member_id;

    if v_member_id is null then
      raise exception 'INVALID_MEMBER:%', p_claim_member_id;
    end if;

    v_claimed := true;
  else
    insert into group_members (group_id, user_id, display_name, role, status, claimed_at)
    values (v_invite.group_id, p_user_id, p_display_name, 'member', 'active', now())
    returning id into v_member_id;
  end if;

  update invites
  set use_count = use_count + 1
  where id = v_invite.id;

  insert into client_requests (group_id, client_request_id, resource_id)
  values (v_invite.group_id, p_client_request_id, v_member_id)
  on conflict (group_id, client_request_id) do nothing;

  return jsonb_build_object(
    'group', public.group_json(v_invite.group_id),
    'member', public.group_member_json(v_member_id),
    'claimed', v_claimed
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- create_settlement: the settlement row and its transfers land together. The
-- transfer amounts are still computed in the application (domain/settlement.ts)
-- and passed in; only the write is moved here.
-- ---------------------------------------------------------------------------

create or replace function public.create_settlement(
  p_group_id uuid,
  p_user_id uuid,
  p_settlement_version integer,
  p_calculated_version integer,
  p_transfers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member_id uuid;
  v_settlement_id uuid;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  insert into settlements (
    group_id,
    settlement_version,
    calculated_version,
    status,
    created_by_member_id
  )
  values (p_group_id, p_settlement_version, p_calculated_version, 'draft', v_member_id)
  returning id into v_settlement_id;

  insert into settlement_transfers (settlement_id, from_member_id, to_member_id, amount_minor, currency)
  select
    v_settlement_id,
    (transfer ->> 'from_member_id')::uuid,
    (transfer ->> 'to_member_id')::uuid,
    (transfer ->> 'amount_minor')::integer,
    coalesce(nullif(transfer ->> 'currency', ''), 'TWD')
  from jsonb_array_elements(coalesce(p_transfers, '[]'::jsonb)) as transfer;

  return (
    select jsonb_build_object(
      'id', s.id,
      'group_id', s.group_id,
      'settlement_version', s.settlement_version,
      'calculated_version', s.calculated_version,
      'status', s.status
    )
    from settlements s
    where s.id = v_settlement_id
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- The browser never holds a Postgres role - every call arrives as service_role
-- through the API. Same posture as get_group_detail and admin_console_*.
-- ---------------------------------------------------------------------------

revoke all on function public.expense_json(uuid) from public, anon, authenticated;
revoke all on function public.group_member_json(uuid) from public, anon, authenticated;
revoke all on function public.group_json(uuid) from public, anon, authenticated;
revoke all on function public.create_expense(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.soft_delete_expense(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.replace_expense(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.accept_invite(text, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.create_settlement(uuid, uuid, integer, integer, jsonb) from public, anon, authenticated;

grant execute on function public.expense_json(uuid) to service_role;
grant execute on function public.group_member_json(uuid) to service_role;
grant execute on function public.group_json(uuid) to service_role;
grant execute on function public.create_expense(uuid, uuid, jsonb) to service_role;
grant execute on function public.soft_delete_expense(uuid, uuid, uuid, text) to service_role;
grant execute on function public.replace_expense(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.accept_invite(text, uuid, text, uuid, text) to service_role;
grant execute on function public.create_settlement(uuid, uuid, integer, integer, jsonb) to service_role;
