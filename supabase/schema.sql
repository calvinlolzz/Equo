-- Equo — full database schema baseline.
--
-- This is the COMPLETE current state of the production `public` schema, produced
-- by `supabase db dump --schema public` against the live database and verified
-- object-by-object against pg_catalog (16 tables, 69 constraints, 24 indexes,
-- 23 functions, 1 view, 38 policies, RLS on all 16 tables, service_role grants).
--
-- It supersedes the old hand-written schema.sql, which described the pre-MVP
-- prototype and had drifted from reality. For a fresh database, apply THIS file;
-- it already contains the folded result of every migration. The files in
-- supabase/migrations/ are kept as the historical record of how the schema got
-- here and are NOT applied on top of this baseline.
--
-- Regenerate with:
--   npx supabase db dump --schema public -f supabase/schema.sql
-- then re-append the event trigger below (see note).




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_invite"("p_token_hash" "text", "p_user_id" "uuid", "p_display_name" "text", "p_claim_member_id" "uuid", "p_client_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invite invites%rowtype;
  v_member_id uuid;
  v_claimed boolean := false;
begin
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
$$;


ALTER FUNCTION "public"."accept_invite"("p_token_hash" "text", "p_user_id" "uuid", "p_display_name" "text", "p_claim_member_id" "uuid", "p_client_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_audit_logs"("p_limit" integer, "p_offset" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'total', (select count(*) from admin_audit_logs),
    'logs', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, admin_email, action, metadata, created_at
        from admin_audit_logs
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."admin_console_audit_logs"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_errors"("p_limit" integer, "p_offset" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'total', (select count(*) from app_error_logs),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select e.id, u.email as user_email, e.source, e.message, e.context, e.page, e.created_at
        from app_error_logs e
        left join users u on u.id = e.user_id
        order by e.created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."admin_console_errors"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_feedback"("p_limit" integer, "p_offset" integer, "p_status" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select f.*, u.email as user_email
    from app_feedback f
    left join users u on u.id = f.user_id
    where coalesce(nullif(p_status, ''), 'all') = 'all' or f.status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'feedback', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, user_email, type, message, contact, page, status, created_at
        from filtered
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."admin_console_feedback"("p_limit" integer, "p_offset" integer, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_groups"("p_search" "text", "p_limit" integer, "p_offset" integer, "p_filter" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select g.*
    from groups g
    where (
        p_search is null or p_search = ''
        or g.name ilike '%' || p_search || '%'
      )
      and case coalesce(nullif(p_filter, ''), 'all')
        when 'deleted' then g.deleted_at is not null
        when 'archived' then g.deleted_at is null and g.archived_at is not null
        when 'empty' then g.deleted_at is null and not exists (
          select 1 from expenses e where e.group_id = g.id and e.deleted_at is null
        )
        else g.deleted_at is null
      end
  ),
  page as (
    select
      f.id,
      f.name,
      f.currency,
      f.created_at,
      f.archived_at,
      f.deleted_at,
      (
        select count(*) from group_members gm
        where gm.group_id = f.id and gm.status = 'active'
      ) as member_count,
      (
        select count(*) from expenses e
        where e.group_id = f.id and e.deleted_at is null
      ) as expense_count,
      coalesce((
        select sum(e.amount_minor) from expenses e
        where e.group_id = f.id and e.deleted_at is null and e.kind = 'expense'
      ), 0) as spend_total_minor,
      (
        select max(e.created_at) from expenses e
        where e.group_id = f.id and e.deleted_at is null
      ) as last_expense_at,
      (
        select gm.display_name from group_members gm
        where gm.id = f.owner_member_id
      ) as owner_display_name
    from filtered f
    order by f.created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'groups', coalesce((select jsonb_agg(to_jsonb(page.*)) from page), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."admin_console_groups"("p_search" "text", "p_limit" integer, "p_offset" integer, "p_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_overview"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'user_count', (select count(*) from users where deleted_at is null),
    -- users.updated_at is refreshed on every login upsert, so it doubles as
    -- a "last seen" timestamp without needing a separate activity table.
    'active_users_7d', (
      select count(*) from users
      where deleted_at is null and updated_at > now() - interval '7 days'
    ),
    'new_users_7d', (
      select count(*) from users
      where deleted_at is null and created_at > now() - interval '7 days'
    ),
    'group_count', (select count(*) from groups where deleted_at is null),
    'active_groups_7d', (
      select count(distinct group_id) from expenses
      where deleted_at is null and created_at > now() - interval '7 days'
    ),
    'expense_count', (select count(*) from expenses where deleted_at is null),
    'expenses_7d', (
      select count(*) from expenses
      where deleted_at is null and created_at > now() - interval '7 days'
    )
  );
$$;


ALTER FUNCTION "public"."admin_console_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_role"("p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.app_admins where user_id = p_user_id;
$$;


ALTER FUNCTION "public"."admin_console_role"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_set_feedback_status"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row app_feedback%rowtype;
begin
  if p_status not in ('new', 'reviewing', 'done') then
    raise exception 'invalid feedback status: %', p_status;
  end if;

  update app_feedback
  set status = p_status
  where id = p_feedback_id
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'feedback.status',
    jsonb_build_object('feedback_id', v_row.id, 'status', p_status)
  );

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end
$$;


ALTER FUNCTION "public"."admin_console_set_feedback_status"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_set_group_archived"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_archived" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row groups%rowtype;
begin
  update groups
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      updated_at = now()
  where id = p_group_id and deleted_at is null
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    case when p_archived then 'group.archive' else 'group.unarchive' end,
    jsonb_build_object('group_id', v_row.id, 'name', v_row.name)
  );

  return jsonb_build_object('id', v_row.id, 'archived_at', v_row.archived_at, 'deleted_at', v_row.deleted_at);
end
$$;


ALTER FUNCTION "public"."admin_console_set_group_archived"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_archived" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_set_group_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_deleted" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row groups%rowtype;
begin
  update groups
  set deleted_at = case when p_deleted then coalesce(deleted_at, now()) else null end,
      updated_at = now()
  where id = p_group_id
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    case when p_deleted then 'group.delete' else 'group.restore' end,
    jsonb_build_object('group_id', v_row.id, 'name', v_row.name)
  );

  return jsonb_build_object('id', v_row.id, 'archived_at', v_row.archived_at, 'deleted_at', v_row.deleted_at);
end
$$;


ALTER FUNCTION "public"."admin_console_set_group_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_deleted" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_set_user_disabled"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid", "p_disabled" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row users%rowtype;
begin
  update users
  set deleted_at = case when p_disabled then coalesce(deleted_at, now()) else null end
  where id = p_user_id
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    case when p_disabled then 'user.disable' else 'user.enable' end,
    jsonb_build_object('user_id', v_row.id, 'email', v_row.email)
  );

  return jsonb_build_object('id', v_row.id, 'disabled_at', v_row.deleted_at);
end
$$;


ALTER FUNCTION "public"."admin_console_set_user_disabled"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid", "p_disabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_user_detail"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when u.id is null then null else jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url,
      'created_at', u.created_at,
      'last_seen_at', u.updated_at,
      'disabled_at', u.deleted_at,
      'group_count', (
        select count(*) from group_members gm
        join groups g on g.id = gm.group_id and g.deleted_at is null
        where gm.user_id = u.id and gm.status = 'active'
      ),
      'expense_count', (
        select count(*) from expenses e
        join group_members gm on gm.id = e.created_by_member_id
        where gm.user_id = u.id and e.deleted_at is null
      )
    ),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'currency', g.currency,
        'role', gm.role,
        'member_status', gm.status,
        'joined_at', gm.created_at,
        'archived_at', g.archived_at,
        'member_count', (
          select count(*) from group_members gm2
          where gm2.group_id = g.id and gm2.status = 'active'
        ),
        'expense_count', (
          select count(*) from expenses e
          where e.group_id = g.id and e.deleted_at is null
        ),
        'spend_total_minor', coalesce((
          select sum(e.amount_minor) from expenses e
          where e.group_id = g.id and e.deleted_at is null and e.kind = 'expense'
        ), 0),
        'last_expense_at', (
          select max(e.created_at) from expenses e
          where e.group_id = g.id and e.deleted_at is null
        )
      ) order by gm.created_at desc)
      from group_members gm
      join groups g on g.id = gm.group_id and g.deleted_at is null
      where gm.user_id = u.id
    ), '[]'::jsonb)
  ) end
  from (select 1) placeholder
  left join users u on u.id = p_user_id;
$$;


ALTER FUNCTION "public"."admin_console_user_detail"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_users"("p_search" "text", "p_limit" integer, "p_offset" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select u.*
    from users u
    where (
      p_search is null or p_search = ''
      or u.email ilike '%' || p_search || '%'
      or u.display_name ilike '%' || p_search || '%'
    )
  ),
  page as (
    select
      f.id,
      f.email,
      f.display_name,
      f.avatar_url,
      f.created_at,
      f.updated_at as last_seen_at,
      f.deleted_at as disabled_at,
      (
        select count(*) from group_members gm
        join groups g on g.id = gm.group_id and g.deleted_at is null
        where gm.user_id = f.id and gm.status = 'active'
      ) as group_count,
      (
        select count(*) from expenses e
        join group_members gm on gm.id = e.created_by_member_id
        where gm.user_id = f.id and e.deleted_at is null
      ) as expense_count
    from filtered f
    order by f.updated_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'users', coalesce((select jsonb_agg(to_jsonb(page.*)) from page), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."admin_console_users"("p_search" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = v_client_request_id;

  if v_existing_id is not null then
    return public.expense_json(v_existing_id);
  end if;

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
$$;


ALTER FUNCTION "public"."create_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_settlement"("p_group_id" "uuid", "p_user_id" "uuid", "p_settlement_version" integer, "p_calculated_version" integer, "p_transfers" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."create_settlement"("p_group_id" "uuid", "p_user_id" "uuid", "p_settlement_version" integer, "p_calculated_version" integer, "p_transfers" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expense_json"("p_expense_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."expense_json"("p_expense_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_group_detail"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when not exists (
      select 1 from group_members gm
      where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.status = 'active'
    ) then null
    when not exists (
      select 1 from groups g where g.id = p_group_id and g.deleted_at is null
    ) then null
    else jsonb_build_object(
      'group', (
        select jsonb_build_object(
          'id', g.id, 'name', g.name, 'currency', g.currency,
          'owner_member_id', g.owner_member_id, 'cover_image_url', g.cover_image_url
        )
        from groups g where g.id = p_group_id
      ),
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id, 'group_id', m.group_id, 'user_id', m.user_id,
          'display_name', m.display_name, 'role', m.role, 'status', m.status,
          'avatar_url', u.avatar_url
        )), '[]'::jsonb)
        from group_members m
        left join users u on u.id = m.user_id
        where m.group_id = p_group_id
      ),
      'expenses', (
        select coalesce(jsonb_agg(e_row.data), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'id', e.id, 'group_id', e.group_id, 'title', e.title, 'kind', e.kind,
            'category', e.category, 'amount_minor', e.amount_minor, 'currency', e.currency,
            'expense_date', e.expense_date, 'note', e.note,
            'transfer_to_member_id', e.transfer_to_member_id, 'created_at', e.created_at,
            'version', e.version, 'client_request_id', e.client_request_id, 'image_url', e.image_url,
            'expense_payments', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'payer_member_id', p.payer_member_id, 'amount_minor', p.amount_minor, 'currency', p.currency
              )), '[]'::jsonb)
              from expense_payments p where p.expense_id = e.id
            ),
            'expense_shares', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'member_id', s.member_id, 'share_type', s.share_type,
                'share_value', s.share_value, 'amount_minor', s.amount_minor
              )), '[]'::jsonb)
              from expense_shares s where s.expense_id = e.id
            )
          ) as data
          from expenses e
          where e.group_id = p_group_id and e.deleted_at is null
          order by e.expense_date desc, e.created_at desc
          limit greatest(coalesce(p_expense_limit, 100), 1)
        ) e_row
      ),
      'expense_count', (
        select count(*) from expenses e
        where e.group_id = p_group_id and e.deleted_at is null
      ),
      'spend_total_minor', (
        select coalesce(sum(e.amount_minor), 0) from expenses e
        where e.group_id = p_group_id and e.deleted_at is null and e.kind = 'expense'
      ),
      'spend_by_day', (
        select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'total_minor', d.total_minor)), '[]'::jsonb)
        from (
          select e.expense_date as day, sum(e.amount_minor)::integer as total_minor
          from expenses e
          where e.group_id = p_group_id and e.deleted_at is null and e.kind = 'expense'
            and e.expense_date >= (current_date - interval '7 days')::date
          group by e.expense_date
        ) d
      ),
      'spend_by_category', (
        select coalesce(jsonb_agg(
          jsonb_build_object('category', c.category, 'total_minor', c.total_minor)
          order by c.total_minor desc
        ), '[]'::jsonb)
        from (
          select coalesce(nullif(e.category, ''), 'general') as category,
                 sum(e.amount_minor)::integer as total_minor
          from expenses e
          where e.group_id = p_group_id and e.deleted_at is null and e.kind = 'expense'
          group by 1
        ) c
      ),
      'member_day_shares', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day, 'member_id', d.member_id, 'share_minor', d.share_minor
        )), '[]'::jsonb)
        from (
          select e.expense_date as day, s.member_id, sum(s.amount_minor)::integer as share_minor
          from expenses e
          join expense_shares s on s.expense_id = e.id
          where e.group_id = p_group_id and e.deleted_at is null and e.kind = 'expense'
            and e.expense_date >= (current_date - interval '7 days')::date
          group by e.expense_date, s.member_id
        ) d
      ),
      'balances', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'memberId', b.member_id,
          'balance', jsonb_build_object('amount_minor', b.balance_minor, 'currency', b.currency)
        )), '[]'::jsonb)
        from group_member_balances b where b.group_id = p_group_id
      )
    )
  end
$$;


ALTER FUNCTION "public"."get_group_detail"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."group_json"("p_group_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'currency', g.currency,
    'owner_member_id', g.owner_member_id,
    'cover_image_url', g.cover_image_url
  )
  from groups g
  where g.id = p_group_id;
$$;


ALTER FUNCTION "public"."group_json"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."group_member_json"("p_member_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."group_member_json"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_group_member"("target_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group_id
      and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_group_member"("target_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  return jsonb_build_object(
    'expense', public.create_expense(p_group_id, p_user_id, p_payload),
    'previous', v_previous
  );
end;
$$;


ALTER FUNCTION "public"."replace_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."soft_delete_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_client_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."soft_delete_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_client_request_id" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid",
    "admin_email" "text",
    "action" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_admins" (
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'admin'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_admins_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'support'::"text"])))
);


ALTER TABLE "public"."app_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_error_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "source" "text" DEFAULT 'web'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "context" "text",
    "page" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_error_logs_source_check" CHECK (("source" = ANY (ARRAY['web'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."app_error_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" "text" DEFAULT 'problem'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "contact" "text",
    "page" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_feedback_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'reviewing'::"text", 'done'::"text"]))),
    CONSTRAINT "app_feedback_type_check" CHECK (("type" = ANY (ARRAY['problem'::"text", 'suggestion'::"text", 'confusing'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."app_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "actor_member_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "client_request_id" "text" NOT NULL,
    "resource_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_id" "uuid" NOT NULL,
    "payer_member_id" "uuid" NOT NULL,
    "amount_minor" integer NOT NULL,
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expense_payments_amount_minor_check" CHECK (("amount_minor" > 0))
);


ALTER TABLE "public"."expense_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "share_type" "text" NOT NULL,
    "share_value" numeric(12,4),
    "amount_minor" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expense_shares_amount_minor_check" CHECK (("amount_minor" >= 0)),
    CONSTRAINT "expense_shares_share_type_check" CHECK (("share_type" = ANY (ARRAY['equal'::"text", 'fixed'::"text", 'percent'::"text"])))
);


ALTER TABLE "public"."expense_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "amount" numeric(12,2),
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "exchange_rate" numeric(12,6) DEFAULT 1 NOT NULL,
    "payer_id" "uuid",
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "note" "text",
    "receipt_image_url" "text",
    "expense_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_expense_id" "text",
    "payer_member_id" "text",
    "participant_member_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "date_label" "text",
    "created_by_member_id" "uuid",
    "kind" "text" DEFAULT 'expense'::"text" NOT NULL,
    "amount_minor" integer,
    "transfer_to_member_id" "uuid",
    "version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    "client_request_id" "text",
    "image_url" "text",
    CONSTRAINT "expenses_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "expenses_kind_check" CHECK (("kind" = ANY (ARRAY['expense'::"text", 'income'::"text", 'transfer'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."group_member_balances" WITH ("security_invoker"='true') AS
 WITH "paid" AS (
         SELECT "e"."group_id",
            "ep"."payer_member_id" AS "member_id",
            "ep"."currency",
            ("sum"("ep"."amount_minor"))::integer AS "paid_minor"
           FROM ("public"."expenses" "e"
             JOIN "public"."expense_payments" "ep" ON (("ep"."expense_id" = "e"."id")))
          WHERE (("e"."deleted_at" IS NULL) AND ("e"."kind" = ANY (ARRAY['expense'::"text", 'income'::"text"])))
          GROUP BY "e"."group_id", "ep"."payer_member_id", "ep"."currency"
        ), "shared" AS (
         SELECT "e"."group_id",
            "es"."member_id",
            "e"."currency",
            ("sum"("es"."amount_minor"))::integer AS "shared_minor"
           FROM ("public"."expenses" "e"
             JOIN "public"."expense_shares" "es" ON (("es"."expense_id" = "e"."id")))
          WHERE (("e"."deleted_at" IS NULL) AND ("e"."kind" = ANY (ARRAY['expense'::"text", 'income'::"text"])))
          GROUP BY "e"."group_id", "es"."member_id", "e"."currency"
        ), "transfers_given" AS (
         SELECT "e"."group_id",
            "ep"."payer_member_id" AS "member_id",
            "ep"."currency",
            ("sum"("ep"."amount_minor"))::integer AS "transfer_given_minor"
           FROM ("public"."expenses" "e"
             JOIN "public"."expense_payments" "ep" ON (("ep"."expense_id" = "e"."id")))
          WHERE (("e"."deleted_at" IS NULL) AND ("e"."kind" = 'transfer'::"text"))
          GROUP BY "e"."group_id", "ep"."payer_member_id", "ep"."currency"
        ), "transfers_received" AS (
         SELECT "e"."group_id",
            "e"."transfer_to_member_id" AS "member_id",
            "e"."currency",
            ("sum"("e"."amount_minor"))::integer AS "transfer_received_minor"
           FROM "public"."expenses" "e"
          WHERE (("e"."deleted_at" IS NULL) AND ("e"."kind" = 'transfer'::"text") AND ("e"."transfer_to_member_id" IS NOT NULL))
          GROUP BY "e"."group_id", "e"."transfer_to_member_id", "e"."currency"
        ), "member_currency" AS (
         SELECT "paid_1"."group_id",
            "paid_1"."member_id",
            "paid_1"."currency"
           FROM "paid" "paid_1"
        UNION
         SELECT "shared_1"."group_id",
            "shared_1"."member_id",
            "shared_1"."currency"
           FROM "shared" "shared_1"
        UNION
         SELECT "transfers_given"."group_id",
            "transfers_given"."member_id",
            "transfers_given"."currency"
           FROM "transfers_given"
        UNION
         SELECT "transfers_received"."group_id",
            "transfers_received"."member_id",
            "transfers_received"."currency"
           FROM "transfers_received"
        )
 SELECT "mc"."group_id",
    "mc"."member_id",
    "mc"."currency",
    (((COALESCE("paid"."paid_minor", 0) - COALESCE("shared"."shared_minor", 0)) + COALESCE("tg"."transfer_given_minor", 0)) - COALESCE("tr"."transfer_received_minor", 0)) AS "balance_minor"
   FROM (((("member_currency" "mc"
     LEFT JOIN "paid" ON ((("paid"."group_id" = "mc"."group_id") AND ("paid"."member_id" = "mc"."member_id") AND ("paid"."currency" = "mc"."currency"))))
     LEFT JOIN "shared" ON ((("shared"."group_id" = "mc"."group_id") AND ("shared"."member_id" = "mc"."member_id") AND ("shared"."currency" = "mc"."currency"))))
     LEFT JOIN "transfers_given" "tg" ON ((("tg"."group_id" = "mc"."group_id") AND ("tg"."member_id" = "mc"."member_id") AND ("tg"."currency" = "mc"."currency"))))
     LEFT JOIN "transfers_received" "tr" ON ((("tr"."group_id" = "mc"."group_id") AND ("tr"."member_id" = "mc"."member_id") AND ("tr"."currency" = "mc"."currency"))));


ALTER VIEW "public"."group_member_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_member_id" "text",
    "display_name" "text",
    "initial" "text",
    "avatar" "text",
    "avatar_color" "text",
    "photo_url" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "claimed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'parent'::"text", 'child'::"text", 'member'::"text", 'guest'::"text"]))),
    CONSTRAINT "group_members_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "image_url" "text",
    "base_currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "budget" numeric(12,2) DEFAULT 0 NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_group_id" "text",
    "subtitle" "text",
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "owner_member_id" "uuid",
    "deleted_at" timestamp with time zone,
    "cover_image_url" "text"
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "max_uses" integer DEFAULT 1 NOT NULL,
    "use_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "created_by_member_id" "uuid" NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invites_max_uses_check" CHECK (("max_uses" > 0)),
    CONSTRAINT "invites_use_count_check" CHECK (("use_count" >= 0))
);


ALTER TABLE "public"."invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "avatar_url" "text",
    "default_currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlement_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settlement_id" "uuid" NOT NULL,
    "from_member_id" "uuid" NOT NULL,
    "to_member_id" "uuid" NOT NULL,
    "amount_minor" integer NOT NULL,
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "confirmed_expense_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "settlement_transfers_amount_minor_check" CHECK (("amount_minor" > 0))
);


ALTER TABLE "public"."settlement_transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "from_user_id" "uuid",
    "to_user_id" "uuid",
    "amount" numeric(12,2),
    "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
    "status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "paid_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settlement_version" integer,
    "calculated_version" integer,
    "created_by_member_id" "uuid",
    "superseded_at" timestamp with time zone,
    CONSTRAINT "settlements_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "settlements_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'confirmed'::"text", 'superseded'::"text", 'unpaid'::"text", 'paid'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."settlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "google_sub" "text" NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_admins"
    ADD CONSTRAINT "app_admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."app_error_logs"
    ADD CONSTRAINT "app_error_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_group_id_client_request_id_key" UNIQUE ("group_id", "client_request_id");



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_payments"
    ADD CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_shares"
    ADD CONSTRAINT "expense_shares_expense_id_member_id_key" UNIQUE ("expense_id", "member_id");



ALTER TABLE ONLY "public"."expense_shares"
    ADD CONSTRAINT "expense_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_user_id_key" UNIQUE ("group_id", "user_id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlement_transfers"
    ADD CONSTRAINT "settlement_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_google_sub_key" UNIQUE ("google_sub");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_actor_member_id_idx" ON "public"."audit_logs" USING "btree" ("actor_member_id");



CREATE INDEX "audit_logs_group_id_idx" ON "public"."audit_logs" USING "btree" ("group_id");



CREATE INDEX "client_requests_group_id_idx" ON "public"."client_requests" USING "btree" ("group_id");



CREATE INDEX "expense_payments_expense_id_idx" ON "public"."expense_payments" USING "btree" ("expense_id");



CREATE INDEX "expense_payments_payer_member_id_idx" ON "public"."expense_payments" USING "btree" ("payer_member_id");



CREATE INDEX "expense_shares_member_id_idx" ON "public"."expense_shares" USING "btree" ("member_id");



CREATE INDEX "expenses_created_by_member_id_idx" ON "public"."expenses" USING "btree" ("created_by_member_id");



CREATE UNIQUE INDEX "expenses_group_app_expense_id_key" ON "public"."expenses" USING "btree" ("group_id", "app_expense_id") WHERE ("app_expense_id" IS NOT NULL);



CREATE UNIQUE INDEX "expenses_group_client_request_id_key" ON "public"."expenses" USING "btree" ("group_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "expenses_group_id_date_idx" ON "public"."expenses" USING "btree" ("group_id", "expense_date" DESC);



CREATE INDEX "expenses_transfer_to_member_id_idx" ON "public"."expenses" USING "btree" ("transfer_to_member_id");



CREATE UNIQUE INDEX "group_members_active_user_per_group_key" ON "public"."group_members" USING "btree" ("group_id", "user_id") WHERE (("user_id" IS NOT NULL) AND ("status" = 'active'::"text"));



CREATE UNIQUE INDEX "group_members_group_app_member_id_key" ON "public"."group_members" USING "btree" ("group_id", "app_member_id") WHERE ("app_member_id" IS NOT NULL);



CREATE INDEX "group_members_group_id_idx" ON "public"."group_members" USING "btree" ("group_id");



CREATE INDEX "group_members_user_id_idx" ON "public"."group_members" USING "btree" ("user_id");



CREATE UNIQUE INDEX "groups_owner_app_group_id_key" ON "public"."groups" USING "btree" ("owner_id", "app_group_id") WHERE ("app_group_id" IS NOT NULL);



CREATE INDEX "groups_owner_member_id_idx" ON "public"."groups" USING "btree" ("owner_member_id");



CREATE INDEX "invites_created_by_member_id_idx" ON "public"."invites" USING "btree" ("created_by_member_id");



CREATE INDEX "invites_group_id_idx" ON "public"."invites" USING "btree" ("group_id");



CREATE INDEX "settlement_transfers_confirmed_expense_id_idx" ON "public"."settlement_transfers" USING "btree" ("confirmed_expense_id");



CREATE INDEX "settlement_transfers_from_member_id_idx" ON "public"."settlement_transfers" USING "btree" ("from_member_id");



CREATE INDEX "settlement_transfers_settlement_id_idx" ON "public"."settlement_transfers" USING "btree" ("settlement_id");



CREATE INDEX "settlement_transfers_to_member_id_idx" ON "public"."settlement_transfers" USING "btree" ("to_member_id");



CREATE INDEX "settlements_group_id_version_idx" ON "public"."settlements" USING "btree" ("group_id", "settlement_version" DESC);



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_admins"
    ADD CONSTRAINT "app_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_error_logs"
    ADD CONSTRAINT "app_error_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "public"."group_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_requests"
    ADD CONSTRAINT "client_requests_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_payments"
    ADD CONSTRAINT "expense_payments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_payments"
    ADD CONSTRAINT "expense_payments_payer_member_id_fkey" FOREIGN KEY ("payer_member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expense_shares"
    ADD CONSTRAINT "expense_shares_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_shares"
    ADD CONSTRAINT "expense_shares_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_transfer_to_member_id_fkey" FOREIGN KEY ("transfer_to_member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_owner_member_id_fkey" FOREIGN KEY ("owner_member_id") REFERENCES "public"."group_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."group_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlement_transfers"
    ADD CONSTRAINT "settlement_transfers_confirmed_expense_id_fkey" FOREIGN KEY ("confirmed_expense_id") REFERENCES "public"."expenses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."settlement_transfers"
    ADD CONSTRAINT "settlement_transfers_from_member_id_fkey" FOREIGN KEY ("from_member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."settlement_transfers"
    ADD CONSTRAINT "settlement_transfers_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlement_transfers"
    ADD CONSTRAINT "settlement_transfers_to_member_id_fkey" FOREIGN KEY ("to_member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."group_members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."admin_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_logs_select_admins" ON "public"."admin_audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."app_admins"
  WHERE ("app_admins"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."app_admins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_admins_select_self" ON "public"."app_admins" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."app_error_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_error_logs_deny_all" ON "public"."app_error_logs" AS RESTRICTIVE TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."app_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_feedback_deny_all" ON "public"."app_feedback" AS RESTRICTIVE TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_group_member" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "audit_logs"."group_id") AND ("group_members"."id" = "audit_logs"."actor_member_id") AND (("group_members"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("group_members"."status" = 'active'::"text")))));



CREATE POLICY "audit_logs_select_group_member" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "audit_logs"."group_id") AND (("group_members"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("group_members"."status" = 'active'::"text")))));



ALTER TABLE "public"."client_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_requests_insert_group_member" ON "public"."client_requests" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "client_requests"."group_id") AND (("group_members"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("group_members"."status" = 'active'::"text")))));



CREATE POLICY "client_requests_select_group_member" ON "public"."client_requests" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "client_requests"."group_id") AND (("group_members"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("group_members"."status" = 'active'::"text")))));



ALTER TABLE "public"."expense_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_payments_insert_group_member" ON "public"."expense_payments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."expenses" "e"
     JOIN "public"."group_members" "gm" ON (("gm"."group_id" = "e"."group_id")))
  WHERE (("e"."id" = "expense_payments"."expense_id") AND (("gm"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("gm"."status" = 'active'::"text")))));



CREATE POLICY "expense_payments_select_group_member" ON "public"."expense_payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."expenses" "e"
     JOIN "public"."group_members" "gm" ON (("gm"."group_id" = "e"."group_id")))
  WHERE (("e"."id" = "expense_payments"."expense_id") AND (("gm"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("gm"."status" = 'active'::"text")))));



ALTER TABLE "public"."expense_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_shares_insert_group_member" ON "public"."expense_shares" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."expenses" "e"
     JOIN "public"."group_members" "gm" ON (("gm"."group_id" = "e"."group_id")))
  WHERE (("e"."id" = "expense_shares"."expense_id") AND (("gm"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("gm"."status" = 'active'::"text")))));



CREATE POLICY "expense_shares_select_group_member" ON "public"."expense_shares" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."expenses" "e"
     JOIN "public"."group_members" "gm" ON (("gm"."group_id" = "e"."group_id")))
  WHERE (("e"."id" = "expense_shares"."expense_id") AND (("gm"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("gm"."status" = 'active'::"text")))));



ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expenses_delete_group_member" ON "public"."expenses" FOR DELETE USING ("public"."is_group_member"("group_id"));



CREATE POLICY "expenses_insert_group_member" ON "public"."expenses" FOR INSERT WITH CHECK (("public"."is_group_member"("group_id") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "expenses_select_group_member" ON "public"."expenses" FOR SELECT USING ("public"."is_group_member"("group_id"));



CREATE POLICY "expenses_update_group_member" ON "public"."expenses" FOR UPDATE USING ("public"."is_group_member"("group_id"));



ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "groups_delete_owner" ON "public"."groups" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "groups_insert_owner" ON "public"."groups" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "groups_select_member_or_owner" ON "public"."groups" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR "public"."is_group_member"("id")));



CREATE POLICY "groups_update_owner" ON "public"."groups" FOR UPDATE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "groups_update_owner_or_admin" ON "public"."groups" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "groups"."id") AND ("group_members"."user_id" = "auth"."uid"()) AND ("group_members"."role" = ANY (ARRAY['admin'::"text", 'parent'::"text"]))))));



ALTER TABLE "public"."invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invites_insert_group_member" ON "public"."invites" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "invites"."group_id") AND ("group_members"."id" = "invites"."created_by_member_id") AND (("group_members"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("group_members"."status" = 'active'::"text")))));



CREATE POLICY "invites_select_group_member" ON "public"."invites" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."group_members"
  WHERE (("group_members"."group_id" = "invites"."group_id") AND (("group_members"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("group_members"."status" = 'active'::"text")))));



CREATE POLICY "members_delete_owner_or_admin" ON "public"."group_members" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."groups"
  WHERE (("groups"."id" = "group_members"."group_id") AND ("groups"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."group_members" "existing_member"
  WHERE (("existing_member"."group_id" = "group_members"."group_id") AND ("existing_member"."user_id" = "auth"."uid"()) AND ("existing_member"."role" = ANY (ARRAY['admin'::"text", 'parent'::"text"])))))));



CREATE POLICY "members_insert_owner_or_admin" ON "public"."group_members" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."groups"
  WHERE (("groups"."id" = "group_members"."group_id") AND ("groups"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."group_members" "existing_member"
  WHERE (("existing_member"."group_id" = "group_members"."group_id") AND ("existing_member"."user_id" = "auth"."uid"()) AND ("existing_member"."role" = ANY (ARRAY['admin'::"text", 'parent'::"text"])))))));



CREATE POLICY "members_select_group_member" ON "public"."group_members" FOR SELECT USING ("public"."is_group_member"("group_id"));



CREATE POLICY "members_update_owner_or_admin" ON "public"."group_members" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."groups"
  WHERE (("groups"."id" = "group_members"."group_id") AND ("groups"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."group_members" "existing_member"
  WHERE (("existing_member"."group_id" = "group_members"."group_id") AND ("existing_member"."user_id" = "auth"."uid"()) AND ("existing_member"."role" = ANY (ARRAY['admin'::"text", 'parent'::"text"])))))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_self" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."settlement_transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settlement_transfers_insert_group_member" ON "public"."settlement_transfers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."settlements" "s"
     JOIN "public"."group_members" "gm" ON (("gm"."group_id" = "s"."group_id")))
  WHERE (("s"."id" = "settlement_transfers"."settlement_id") AND (("gm"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("gm"."status" = 'active'::"text")))));



CREATE POLICY "settlement_transfers_select_group_member" ON "public"."settlement_transfers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."settlements" "s"
     JOIN "public"."group_members" "gm" ON (("gm"."group_id" = "s"."group_id")))
  WHERE (("s"."id" = "settlement_transfers"."settlement_id") AND (("gm"."user_id")::"text" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND ("gm"."status" = 'active'::"text")))));



ALTER TABLE "public"."settlements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settlements_insert_group_member" ON "public"."settlements" FOR INSERT WITH CHECK ("public"."is_group_member"("group_id"));



CREATE POLICY "settlements_select_group_member" ON "public"."settlements" FOR SELECT USING ("public"."is_group_member"("group_id"));



CREATE POLICY "settlements_update_group_member" ON "public"."settlements" FOR UPDATE USING ("public"."is_group_member"("group_id"));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_insert_authenticated" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid"))::"text" = ("id")::"text"));



CREATE POLICY "users_select_self" ON "public"."users" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid"))::"text" = ("id")::"text"));



CREATE POLICY "users_update_self" ON "public"."users" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid"))::"text" = ("id")::"text")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid"))::"text" = ("id")::"text"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_invite"("p_token_hash" "text", "p_user_id" "uuid", "p_display_name" "text", "p_claim_member_id" "uuid", "p_client_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invite"("p_token_hash" "text", "p_user_id" "uuid", "p_display_name" "text", "p_claim_member_id" "uuid", "p_client_request_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_audit_logs"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_audit_logs"("p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_errors"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_errors"("p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_feedback"("p_limit" integer, "p_offset" integer, "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_feedback"("p_limit" integer, "p_offset" integer, "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_groups"("p_search" "text", "p_limit" integer, "p_offset" integer, "p_filter" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_groups"("p_search" "text", "p_limit" integer, "p_offset" integer, "p_filter" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_overview"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_role"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_role"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_set_feedback_status"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_feedback_status"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_set_group_archived"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_archived" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_group_archived"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_archived" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_set_group_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_group_deleted"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_deleted" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_set_user_disabled"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid", "p_disabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_user_disabled"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid", "p_disabled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_user_detail"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_user_detail"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_console_users"("p_search" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_users"("p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_settlement"("p_group_id" "uuid", "p_user_id" "uuid", "p_settlement_version" integer, "p_calculated_version" integer, "p_transfers" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_settlement"("p_group_id" "uuid", "p_user_id" "uuid", "p_settlement_version" integer, "p_calculated_version" integer, "p_transfers" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expense_json"("p_expense_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expense_json"("p_expense_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_group_detail"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_detail"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_json"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_json"("p_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_member_json"("p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_member_json"("p_member_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_group_member"("target_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_group_member"("target_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."soft_delete_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_client_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."soft_delete_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_client_request_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."app_admins" TO "service_role";



GRANT ALL ON TABLE "public"."app_error_logs" TO "service_role";



GRANT ALL ON TABLE "public"."app_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."client_requests" TO "service_role";



GRANT ALL ON TABLE "public"."expense_payments" TO "service_role";



GRANT ALL ON TABLE "public"."expense_shares" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."group_member_balances" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."invites" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."settlement_transfers" TO "service_role";



GRANT ALL ON TABLE "public"."settlements" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,USAGE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


-- ---------------------------------------------------------------------------
-- Re-added after the dump: `ensure_rls` is a database-global event trigger, so
-- `supabase db dump --schema public` omits it (its function, public.rls_auto_enable,
-- IS dumped above). It auto-enables row level security on any new table created
-- in the public schema. Transcribed from the live catalog.
-- ---------------------------------------------------------------------------
CREATE EVENT TRIGGER "ensure_rls" ON "ddl_command_end"
    EXECUTE FUNCTION "public"."rls_auto_enable"();
