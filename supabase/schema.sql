create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  default_currency text not null default 'TWD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  app_group_id text,
  name text not null,
  subtitle text,
  image_url text,
  base_currency text not null default 'TWD',
  budget numeric(12, 2) not null default 0,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  app_member_id text,
  display_name text,
  initial text,
  avatar text,
  avatar_color text,
  photo_url text,
  role text not null default 'member' check (role in ('admin', 'parent', 'child', 'member', 'guest')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token text not null unique,
  role text not null default 'member' check (role in ('admin', 'parent', 'child', 'member', 'guest')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  app_expense_id text,
  title text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'TWD',
  exchange_rate numeric(12, 6) not null default 1,
  payer_id uuid not null references public.profiles(id),
  payer_member_id text,
  participant_member_ids text[] not null default '{}',
  category text not null default 'other',
  note text,
  receipt_image_url text,
  expense_date date not null default current_date,
  date_label text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  split_type text not null default 'average',
  weight numeric(12, 4),
  created_at timestamptz not null default now(),
  unique (expense_id, user_id)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id),
  to_user_id uuid not null references public.profiles(id),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'TWD',
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'confirmed', 'cancelled')),
  paid_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlement_statuses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  settlement_key text not null,
  from_member_id text not null,
  to_member_id text not null,
  amount numeric(12, 2) not null default 0,
  status text not null default 'paid' check (status in ('paid', 'confirmed', 'cancelled')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (group_id, settlement_key)
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid references public.settlements(id) on delete set null,
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id),
  to_user_id uuid not null references public.profiles(id),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'TWD',
  provider text not null default 'manual',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'TWD',
  payer_id uuid not null references public.profiles(id),
  category text not null default 'other',
  schedule_rule text not null default 'monthly',
  next_run_at date,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.user_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_statuses enable row level security;
alter table public.payment_records enable row level security;
alter table public.recurring_bills enable row level security;
alter table public.notifications enable row level security;
alter table public.user_snapshots enable row level security;

create or replace function public.ensure_profile(
  display_name_input text,
  avatar_url_input text,
  default_currency_input text default 'TWD'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  insert into public.profiles (id, display_name, avatar_url, default_currency, updated_at)
  values (
    auth.uid(),
    coalesce(nullif(display_name_input, ''), 'Equo 使用者'),
    avatar_url_input,
    coalesce(nullif(default_currency_input, ''), 'TWD'),
    now()
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    default_currency = excluded.default_currency,
    updated_at = now();

  return auth.uid();
end;
$$;

create or replace function public.upsert_owned_group(
  app_group_id_input text,
  name_input text,
  subtitle_input text,
  base_currency_input text,
  budget_input numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  group_uuid uuid;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  insert into public.groups (app_group_id, name, subtitle, base_currency, budget, owner_id, updated_at)
  values (
    app_group_id_input,
    coalesce(nullif(name_input, ''), '未命名群組'),
    subtitle_input,
    coalesce(nullif(base_currency_input, ''), 'TWD'),
    coalesce(budget_input, 0),
    auth.uid(),
    now()
  )
  on conflict (owner_id, app_group_id) where app_group_id is not null do update set
    name = excluded.name,
    subtitle = excluded.subtitle,
    base_currency = excluded.base_currency,
    budget = excluded.budget,
    updated_at = now()
  returning id into group_uuid;

  return group_uuid;
end;
$$;

create or replace function public.upsert_group_member(
  group_id_input uuid,
  app_member_id_input text,
  user_id_input uuid,
  role_input text,
  display_name_input text,
  initial_input text,
  avatar_input text,
  avatar_color_input text,
  photo_url_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  member_uuid uuid;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.groups
    where id = group_id_input
      and owner_id = auth.uid()
  ) and not exists (
    select 1 from public.group_members
    where group_id = group_id_input
      and user_id = auth.uid()
      and role in ('admin', 'parent')
  ) then
    raise exception 'permission_denied';
  end if;

  insert into public.group_members (
    group_id,
    user_id,
    app_member_id,
    role,
    display_name,
    initial,
    avatar,
    avatar_color,
    photo_url
  ) values (
    group_id_input,
    user_id_input,
    app_member_id_input,
    coalesce(nullif(role_input, ''), 'member'),
    coalesce(nullif(display_name_input, ''), '未命名成員'),
    initial_input,
    avatar_input,
    avatar_color_input,
    photo_url_input
  )
  on conflict (group_id, app_member_id) where app_member_id is not null do update set
    user_id = excluded.user_id,
    role = excluded.role,
    display_name = excluded.display_name,
    initial = excluded.initial,
    avatar = excluded.avatar,
    avatar_color = excluded.avatar_color,
    photo_url = excluded.photo_url
  returning id into member_uuid;

  return member_uuid;
end;
$$;

create or replace function public.upsert_group_expense(
  group_id_input uuid,
  app_expense_id_input text,
  title_input text,
  amount_input numeric,
  currency_input text,
  exchange_rate_input numeric,
  payer_member_id_input text,
  participant_member_ids_input text[],
  category_input text,
  note_input text,
  date_label_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  expense_uuid uuid;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.groups
    where id = group_id_input
      and owner_id = auth.uid()
  ) and not exists (
    select 1 from public.group_members
    where group_id = group_id_input
      and user_id = auth.uid()
      and role in ('admin', 'parent', 'member')
  ) then
    raise exception 'permission_denied';
  end if;

  insert into public.expenses (
    group_id,
    app_expense_id,
    title,
    amount,
    currency,
    exchange_rate,
    payer_id,
    payer_member_id,
    participant_member_ids,
    category,
    note,
    date_label,
    created_by,
    updated_at
  ) values (
    group_id_input,
    app_expense_id_input,
    coalesce(nullif(title_input, ''), '未命名支出'),
    greatest(round(coalesce(amount_input, 0)::numeric, 2), 0.01),
    coalesce(nullif(currency_input, ''), 'TWD'),
    coalesce(exchange_rate_input, 1),
    auth.uid(),
    payer_member_id_input,
    coalesce(participant_member_ids_input, array[]::text[]),
    coalesce(nullif(category_input, ''), 'other'),
    coalesce(note_input, ''),
    date_label_input,
    auth.uid(),
    now()
  )
  on conflict (group_id, app_expense_id) where app_expense_id is not null do update set
    title = excluded.title,
    amount = excluded.amount,
    currency = excluded.currency,
    exchange_rate = excluded.exchange_rate,
    payer_id = excluded.payer_id,
    payer_member_id = excluded.payer_member_id,
    participant_member_ids = excluded.participant_member_ids,
    category = excluded.category,
    note = excluded.note,
    date_label = excluded.date_label,
    created_by = excluded.created_by,
    updated_at = now()
  returning id into expense_uuid;

  return expense_uuid;
end;
$$;

create or replace function public.sync_group_expense_deletions(
  group_id_input uuid,
  keep_app_expense_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.groups
    where id = group_id_input
      and owner_id = auth.uid()
  ) and not exists (
    select 1 from public.group_members
    where group_id = group_id_input
      and user_id = auth.uid()
      and role in ('admin', 'parent', 'member')
  ) then
    raise exception 'permission_denied';
  end if;

  delete from public.expenses
  where group_id = group_id_input
    and app_expense_id is not null
    and not (app_expense_id = any(coalesce(keep_app_expense_ids, array[]::text[])));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.sync_group_member_deletions(
  group_id_input uuid,
  keep_app_member_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
  removed_member_ids text[];
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.groups
    where id = group_id_input
      and owner_id = auth.uid()
  ) and not exists (
    select 1 from public.group_members
    where group_id = group_id_input
      and user_id = auth.uid()
      and role in ('admin', 'parent')
  ) then
    raise exception 'permission_denied';
  end if;

  select coalesce(array_agg(app_member_id), array[]::text[])
  into removed_member_ids
  from public.group_members
  where group_id = group_id_input
    and app_member_id is not null
    and not (app_member_id = any(coalesce(keep_app_member_ids, array[]::text[])));

  delete from public.group_members
  where group_id = group_id_input
    and app_member_id is not null
    and not (app_member_id = any(coalesce(keep_app_member_ids, array[]::text[])));

  get diagnostics deleted_count = row_count;

  if array_length(removed_member_ids, 1) is not null then
    delete from public.settlement_statuses
    where group_id = group_id_input
      and (from_member_id = any(removed_member_ids) or to_member_id = any(removed_member_ids));
  end if;

  return deleted_count;
end;
$$;

create or replace function public.sync_owned_group_deletions(
  keep_app_group_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  delete from public.groups
  where owner_id = auth.uid()
    and app_group_id is not null
    and not (app_group_id = any(coalesce(keep_app_group_ids, array[]::text[])));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.get_my_cloud_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  with visible_groups as (
    select g.id
    from public.groups g
    where g.owner_id = auth.uid()
      or exists (
        select 1 from public.group_members gm
        where gm.group_id = g.id
          and gm.user_id = auth.uid()
      )
  ),
  group_rows as (
    select g.id, g.app_group_id, g.name, g.subtitle, g.base_currency, g.budget, g.owner_id, g.created_at
    from public.groups g
    join visible_groups vg on vg.id = g.id
    order by g.created_at
  ),
  member_rows as (
    select gm.group_id, gm.app_member_id, gm.user_id, gm.role, gm.display_name, gm.initial, gm.avatar, gm.avatar_color, gm.photo_url
    from public.group_members gm
    join visible_groups vg on vg.id = gm.group_id
    order by gm.joined_at
  ),
  expense_rows as (
    select e.group_id, e.app_expense_id, e.title, e.amount, e.currency, e.payer_member_id, e.participant_member_ids, e.category, e.note, e.date_label, e.created_at
    from public.expenses e
    join visible_groups vg on vg.id = e.group_id
    order by e.created_at
  ),
  status_rows as (
    select ss.group_id, ss.settlement_key, ss.status
    from public.settlement_statuses ss
    join visible_groups vg on vg.id = ss.group_id
    order by ss.updated_at
  )
  select jsonb_build_object(
    'groups', coalesce((select jsonb_agg(to_jsonb(group_rows)) from group_rows), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(to_jsonb(member_rows)) from member_rows), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(to_jsonb(expense_rows)) from expense_rows), '[]'::jsonb),
    'settlement_statuses', coalesce((select jsonb_agg(to_jsonb(status_rows)) from status_rows), '[]'::jsonb)
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.ensure_profile(text, text, text) from public;
grant execute on function public.ensure_profile(text, text, text) to authenticated;

revoke all on function public.upsert_owned_group(text, text, text, text, numeric) from public;
grant execute on function public.upsert_owned_group(text, text, text, text, numeric) to authenticated;

revoke all on function public.upsert_group_member(uuid, text, uuid, text, text, text, text, text, text) from public;
grant execute on function public.upsert_group_member(uuid, text, uuid, text, text, text, text, text, text) to authenticated;

revoke all on function public.upsert_group_expense(uuid, text, text, numeric, text, numeric, text, text[], text, text, text) from public;
grant execute on function public.upsert_group_expense(uuid, text, text, numeric, text, numeric, text, text[], text, text, text) to authenticated;

revoke all on function public.sync_group_expense_deletions(uuid, text[]) from public;
grant execute on function public.sync_group_expense_deletions(uuid, text[]) to authenticated;

revoke all on function public.sync_group_member_deletions(uuid, text[]) from public;
grant execute on function public.sync_group_member_deletions(uuid, text[]) to authenticated;

revoke all on function public.sync_owned_group_deletions(text[]) from public;
grant execute on function public.sync_owned_group_deletions(text[]) to authenticated;

revoke all on function public.get_my_cloud_data() from public;
grant execute on function public.get_my_cloud_data() to authenticated;

create unique index if not exists groups_owner_app_group_id_key
  on public.groups(owner_id, app_group_id)
  where app_group_id is not null;

create unique index if not exists group_members_group_app_member_id_key
  on public.group_members(group_id, app_member_id)
  where app_member_id is not null;

create unique index if not exists expenses_group_app_expense_id_key
  on public.expenses(group_id, app_expense_id)
  where app_expense_id is not null;

create or replace function public.is_group_member(target_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group_id
      and user_id = auth.uid()
  );
$$;

create policy "profiles_select_self" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid());

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());

create policy "groups_select_member_or_owner" on public.groups
  for select using (
    owner_id = auth.uid()
    or public.is_group_member(id)
  );

create policy "groups_insert_owner" on public.groups
  for insert with check (owner_id = auth.uid());

create policy "groups_update_owner_or_admin" on public.groups
  for update using (
    exists (
      select 1 from public.group_members
      where group_id = groups.id
        and user_id = auth.uid()
        and role in ('admin', 'parent')
    )
  );

create policy "groups_update_owner" on public.groups
  for update using (owner_id = auth.uid());

create policy "groups_delete_owner" on public.groups
  for delete using (owner_id = auth.uid());

create policy "members_select_group_member" on public.group_members
  for select using (public.is_group_member(group_id));

create policy "members_insert_owner_or_admin" on public.group_members
  for insert with check (
    exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members existing_member
      where existing_member.group_id = group_members.group_id
        and existing_member.user_id = auth.uid()
        and existing_member.role in ('admin', 'parent')
    )
  );

create policy "members_update_owner_or_admin" on public.group_members
  for update using (
    exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members existing_member
      where existing_member.group_id = group_members.group_id
        and existing_member.user_id = auth.uid()
        and existing_member.role in ('admin', 'parent')
    )
  );

create policy "members_delete_owner_or_admin" on public.group_members
  for delete using (
    exists (
      select 1 from public.groups
      where groups.id = group_members.group_id
        and groups.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.group_members existing_member
      where existing_member.group_id = group_members.group_id
        and existing_member.user_id = auth.uid()
        and existing_member.role in ('admin', 'parent')
    )
  );

create policy "group_invites_select_group_member_or_creator" on public.group_invites
  for select using (
    public.is_group_member(group_id)
    or created_by = auth.uid()
  );

create policy "group_invites_insert_admin_or_parent" on public.group_invites
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.group_members
      where group_id = group_invites.group_id
        and user_id = auth.uid()
        and role in ('admin', 'parent')
    )
  );

create policy "group_invites_update_invitee_or_creator" on public.group_invites
  for update using (
    created_by = auth.uid()
    or (
      auth.uid() is not null
      and accepted_at is null
      and (expires_at is null or expires_at > now())
    )
  );

create or replace function public.create_group_invite(
  group_id_input uuid,
  token_input text,
  role_input text,
  expires_at_input timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.groups
    where id = group_id_input
      and owner_id = auth.uid()
  ) and not exists (
    select 1 from public.group_members
    where group_id = group_id_input
      and user_id = auth.uid()
      and role in ('admin', 'parent')
  ) then
    raise exception 'permission_denied';
  end if;

  insert into public.group_invites (
    group_id,
    token,
    role,
    created_by,
    expires_at
  ) values (
    group_id_input,
    token_input,
    coalesce(nullif(role_input, ''), 'member'),
    auth.uid(),
    expires_at_input
  );

  return token_input;
end;
$$;

create or replace function public.accept_group_invite(
  invite_token text,
  member_id text,
  member_display_name text,
  member_initial text,
  member_avatar text,
  member_avatar_color text,
  member_photo_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.group_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  select * into invite_row
  from public.group_invites
  where token = invite_token
    and (expires_at is null or expires_at > now())
  limit 1;

  if invite_row.id is null then
    raise exception 'invite_not_available';
  end if;

  insert into public.group_members (
    group_id,
    user_id,
    app_member_id,
    role,
    display_name,
    initial,
    avatar,
    avatar_color,
    photo_url
  ) values (
    invite_row.group_id,
    auth.uid(),
    member_id,
    invite_row.role,
    member_display_name,
    member_initial,
    member_avatar,
    member_avatar_color,
    member_photo_url
  )
  on conflict (group_id, user_id) do update set
    app_member_id = excluded.app_member_id,
    role = excluded.role,
    display_name = excluded.display_name,
    initial = excluded.initial,
    avatar = excluded.avatar,
    avatar_color = excluded.avatar_color,
    photo_url = excluded.photo_url;

  update public.group_invites
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invite_row.id;

  return invite_row.group_id;
end;
$$;

revoke all on function public.create_group_invite(uuid, text, text, timestamptz) from public;
grant execute on function public.create_group_invite(uuid, text, text, timestamptz) to authenticated;

revoke all on function public.accept_group_invite(text, text, text, text, text, text, text) from public;
grant execute on function public.accept_group_invite(text, text, text, text, text, text, text) to authenticated;

create policy "expenses_select_group_member" on public.expenses
  for select using (public.is_group_member(group_id));

create policy "expenses_insert_group_member" on public.expenses
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());

create policy "expenses_update_group_member" on public.expenses
  for update using (public.is_group_member(group_id));

create policy "expenses_delete_group_member" on public.expenses
  for delete using (public.is_group_member(group_id));

create policy "splits_select_via_expense_group" on public.expense_splits
  for select using (
    exists (
      select 1 from public.expenses
      where expenses.id = expense_splits.expense_id
        and public.is_group_member(expenses.group_id)
    )
  );

create policy "splits_insert_via_expense_group" on public.expense_splits
  for insert with check (
    exists (
      select 1 from public.expenses
      where expenses.id = expense_splits.expense_id
        and public.is_group_member(expenses.group_id)
    )
  );

create policy "splits_update_via_expense_group" on public.expense_splits
  for update using (
    exists (
      select 1 from public.expenses
      where expenses.id = expense_splits.expense_id
        and public.is_group_member(expenses.group_id)
    )
  );

create policy "splits_delete_via_expense_group" on public.expense_splits
  for delete using (
    exists (
      select 1 from public.expenses
      where expenses.id = expense_splits.expense_id
        and public.is_group_member(expenses.group_id)
    )
  );

create policy "settlements_select_group_member" on public.settlements
  for select using (public.is_group_member(group_id));

create policy "settlements_insert_group_member" on public.settlements
  for insert with check (public.is_group_member(group_id));

create policy "settlements_update_group_member" on public.settlements
  for update using (public.is_group_member(group_id));

create policy "settlement_statuses_select_group_member" on public.settlement_statuses
  for select using (public.is_group_member(group_id));

create policy "settlement_statuses_insert_group_member" on public.settlement_statuses
  for insert with check (public.is_group_member(group_id));

create policy "settlement_statuses_update_group_member" on public.settlement_statuses
  for update using (public.is_group_member(group_id));

create policy "payments_select_group_member" on public.payment_records
  for select using (public.is_group_member(group_id));

create policy "payments_insert_group_member" on public.payment_records
  for insert with check (public.is_group_member(group_id));

create policy "recurring_select_group_member" on public.recurring_bills
  for select using (public.is_group_member(group_id));

create policy "recurring_insert_admin_or_parent" on public.recurring_bills
  for insert with check (
    exists (
      select 1 from public.group_members
      where group_id = recurring_bills.group_id
        and user_id = auth.uid()
        and role in ('admin', 'parent')
    )
  );

create policy "recurring_update_admin_or_parent" on public.recurring_bills
  for update using (
    exists (
      select 1 from public.group_members
      where group_id = recurring_bills.group_id
        and user_id = auth.uid()
        and role in ('admin', 'parent')
    )
  );

create policy "notifications_select_self" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications_update_self" on public.notifications
  for update using (user_id = auth.uid());

create policy "snapshots_select_self" on public.user_snapshots
  for select using (user_id = auth.uid());

create policy "snapshots_insert_self" on public.user_snapshots
  for insert with check (user_id = auth.uid());

create policy "snapshots_update_self" on public.user_snapshots
  for update using (user_id = auth.uid());

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin', 'support')),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  admin_email text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
alter table public.admin_audit_logs enable row level security;

grant select on public.app_admins to authenticated;
grant select on public.admin_audit_logs to authenticated;

create policy "app_admins_select_self" on public.app_admins
  for select using (user_id = auth.uid());

create policy "admin_logs_select_admins" on public.admin_audit_logs
  for select using (
    exists (
      select 1 from public.app_admins
      where app_admins.user_id = auth.uid()
    )
  );

create or replace function public.record_admin_audit(
  action_input text,
  metadata_input jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  log_id uuid;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.app_admins
    where user_id = auth.uid()
  ) then
    raise exception 'admin_required';
  end if;

  insert into public.admin_audit_logs (
    admin_id,
    admin_email,
    action,
    metadata
  ) values (
    auth.uid(),
    auth.jwt() ->> 'email',
    action_input,
    coalesce(metadata_input, '{}'::jsonb)
  )
  returning id into log_id;

  return log_id;
end;
$$;

create or replace function public.get_admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;

  if not exists (
    select 1 from public.app_admins
    where user_id = auth.uid()
  ) then
    raise exception 'admin_required';
  end if;

  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'users', (select count(*) from public.profiles),
      'groups', (select count(*) from public.groups where archived_at is null),
      'expenses', (select count(*) from public.expenses),
      'settlement_statuses', (select count(*) from public.settlement_statuses)
    ),
    'users', coalesce((
      select jsonb_agg(row_to_json(user_rows))
      from (
        select
          p.display_name,
          p.default_currency,
          p.created_at,
          p.updated_at,
          coalesce(group_counts.group_count, 0) as group_count
        from public.profiles p
        left join (
          select owner_id, count(*) as group_count
          from public.groups
          where archived_at is null
          group by owner_id
        ) group_counts on group_counts.owner_id = p.id
        order by p.updated_at desc nulls last, p.created_at desc
        limit 50
      ) user_rows
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(row_to_json(group_rows))
      from (
        select
          g.name,
          g.subtitle,
          g.base_currency,
          g.budget,
          g.created_at,
          g.updated_at,
          coalesce(member_counts.member_count, 0) as member_count,
          coalesce(expense_counts.expense_count, 0) as expense_count,
          coalesce(expense_counts.total_amount, 0) as total_amount
        from public.groups g
        left join (
          select group_id, count(*) as member_count
          from public.group_members
          group by group_id
        ) member_counts on member_counts.group_id = g.id
        left join (
          select group_id, count(*) as expense_count, sum(amount) as total_amount
          from public.expenses
          group by group_id
        ) expense_counts on expense_counts.group_id = g.id
        where g.archived_at is null
        order by g.updated_at desc nulls last, g.created_at desc
        limit 50
      ) group_rows
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'supabase', 'ok',
      'profiles', (select count(*) from public.profiles),
      'snapshots', (select count(*) from public.user_snapshots)
    ),
    'audit_logs', coalesce((
      select jsonb_agg(row_to_json(audit_rows))
      from (
        select admin_email, action, created_at
        from public.admin_audit_logs
        order by created_at desc
        limit 30
      ) audit_rows
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.record_admin_audit(text, jsonb) from public;
grant execute on function public.record_admin_audit(text, jsonb) to authenticated;

revoke all on function public.get_admin_dashboard() from public;
grant execute on function public.get_admin_dashboard() to authenticated;
