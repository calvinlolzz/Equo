-- Admin console phase 2: management operations (disable/enable users,
-- archive/delete/restore groups), a group list filter, and disabled-status
-- visibility in the user queries.
--
-- Same security model as phase 1: every function is SECURITY DEFINER and
-- executable by service_role only. Every write RPC also records a row in the
-- existing public.admin_audit_logs table (admin_id, admin_email, action,
-- metadata) so there is an audit trail from day one even without a UI.

-- ---- User queries now include disabled accounts ----
-- Phase 1 hid soft-deleted users entirely; the admin must be able to see and
-- re-enable disabled accounts, so the filter moves into a disabled_at field.

create or replace function public.admin_console_users(
  p_search text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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

create or replace function public.admin_console_user_detail(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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

-- ---- Group list gains a filter and deleted visibility ----
-- The 3-arg phase-1 signature is dropped in favour of a 4-arg version with
-- p_filter: 'all' (default, non-deleted), 'archived', 'empty' (non-deleted
-- with zero live expenses - test garbage), 'deleted' (soft-deleted only).

drop function if exists public.admin_console_groups(text, integer, integer);

create or replace function public.admin_console_groups(
  p_search text,
  p_limit integer,
  p_offset integer,
  p_filter text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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

-- ---- Write operations (all audited) ----

create or replace function public.admin_console_set_user_disabled(
  p_actor uuid,
  p_actor_email text,
  p_user_id uuid,
  p_disabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.admin_console_set_group_archived(
  p_actor uuid,
  p_actor_email text,
  p_group_id uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.admin_console_set_group_deleted(
  p_actor uuid,
  p_actor_email text,
  p_group_id uuid,
  p_deleted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

-- ---- Lock down to service_role only ----

revoke execute on function public.admin_console_users(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_console_user_detail(uuid) from public, anon, authenticated;
revoke execute on function public.admin_console_groups(text, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_console_set_user_disabled(uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_console_set_group_archived(uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_console_set_group_deleted(uuid, text, uuid, boolean) from public, anon, authenticated;

grant execute on function public.admin_console_users(text, integer, integer) to service_role;
grant execute on function public.admin_console_user_detail(uuid) to service_role;
grant execute on function public.admin_console_groups(text, integer, integer, text) to service_role;
grant execute on function public.admin_console_set_user_disabled(uuid, text, uuid, boolean) to service_role;
grant execute on function public.admin_console_set_group_archived(uuid, text, uuid, boolean) to service_role;
grant execute on function public.admin_console_set_group_deleted(uuid, text, uuid, boolean) to service_role;
