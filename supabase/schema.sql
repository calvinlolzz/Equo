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
  name text not null,
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
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'parent', 'child', 'member', 'guest')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'TWD',
  exchange_rate numeric(12, 6) not null default 1,
  payer_id uuid not null references public.profiles(id),
  category text not null default 'other',
  note text,
  receipt_image_url text,
  expense_date date not null default current_date,
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
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.payment_records enable row level security;
alter table public.recurring_bills enable row level security;
alter table public.notifications enable row level security;
alter table public.user_snapshots enable row level security;

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

create policy "groups_select_member" on public.groups
  for select using (public.is_group_member(id));

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
