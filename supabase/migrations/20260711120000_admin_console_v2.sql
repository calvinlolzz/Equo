-- Admin console v2: read-only reporting RPCs for the /admin dashboard.
--
-- Design notes:
-- * Reuses the existing public.app_admins table (user_id, role, created_at)
--   as the admin allowlist. Rows are managed by hand in SQL; there is no UI.
-- * Every function is SECURITY DEFINER and executable by service_role ONLY.
--   The Vercel API runtime is the sole caller (it authenticates the Equo
--   session first and checks admin_console_role before serving data), so
--   anon/authenticated must never be able to call these directly.
-- * All functions are read-only aggregates over the MVP-era tables
--   (users, groups, group_members, expenses). Legacy-era tables are not
--   touched here.

create or replace function public.admin_console_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_admins where user_id = p_user_id;
$$;

create or replace function public.admin_console_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    where u.deleted_at is null
      and (
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
  left join users u on u.id = p_user_id and u.deleted_at is null;
$$;

create or replace function public.admin_console_groups(
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
    select g.*
    from groups g
    where g.deleted_at is null
      and (
        p_search is null or p_search = ''
        or g.name ilike '%' || p_search || '%'
      )
  ),
  page as (
    select
      f.id,
      f.name,
      f.currency,
      f.created_at,
      f.archived_at,
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

-- Lock every admin_console_* function down to service_role only. CREATE
-- FUNCTION grants EXECUTE to PUBLIC by default, so revoke explicitly.
revoke execute on function public.admin_console_role(uuid) from public, anon, authenticated;
revoke execute on function public.admin_console_overview() from public, anon, authenticated;
revoke execute on function public.admin_console_users(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_console_user_detail(uuid) from public, anon, authenticated;
revoke execute on function public.admin_console_groups(text, integer, integer) from public, anon, authenticated;

grant execute on function public.admin_console_role(uuid) to service_role;
grant execute on function public.admin_console_overview() to service_role;
grant execute on function public.admin_console_users(text, integer, integer) to service_role;
grant execute on function public.admin_console_user_detail(uuid) to service_role;
grant execute on function public.admin_console_groups(text, integer, integer) to service_role;
