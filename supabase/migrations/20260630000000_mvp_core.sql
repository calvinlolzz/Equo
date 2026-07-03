create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  google_sub text not null unique,
  email text not null,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'TWD',
  owner_member_id uuid,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.groups
  add constraint groups_owner_member_id_fkey
  foreign key (owner_member_id) references public.group_members(id) on delete set null;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash text not null unique,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  expires_at timestamptz,
  created_by_member_id uuid not null references public.group_members(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by_member_id uuid not null references public.group_members(id) on delete restrict,
  title text not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  category text not null default 'other',
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'TWD',
  expense_date date not null default current_date,
  note text,
  transfer_to_member_id uuid references public.group_members(id) on delete restrict,
  version integer not null default 1,
  deleted_at timestamptz,
  client_request_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, client_request_id)
);

create table if not exists public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  payer_member_id uuid not null references public.group_members(id) on delete restrict,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'TWD',
  created_at timestamptz not null default now()
);

create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete restrict,
  share_type text not null check (share_type in ('equal', 'fixed', 'percent')),
  share_value numeric(12, 4),
  amount_minor integer not null check (amount_minor >= 0),
  created_at timestamptz not null default now(),
  unique (expense_id, member_id)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  settlement_version integer not null,
  calculated_version integer not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded')),
  created_by_member_id uuid not null references public.group_members(id) on delete restrict,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.settlement_transfers (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  from_member_id uuid not null references public.group_members(id) on delete restrict,
  to_member_id uuid not null references public.group_members(id) on delete restrict,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'TWD',
  confirmed_expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_member_id uuid references public.group_members(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  client_request_id text not null,
  resource_id uuid,
  created_at timestamptz not null default now(),
  unique (group_id, client_request_id)
);

create index if not exists group_members_group_id_idx on public.group_members(group_id);
create index if not exists expenses_group_id_date_idx on public.expenses(group_id, expense_date desc);
create index if not exists settlements_group_id_version_idx on public.settlements(group_id, settlement_version desc);
create index if not exists client_requests_group_id_idx on public.client_requests(group_id);

alter table public.users enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_transfers enable row level security;
alter table public.audit_logs enable row level security;
alter table public.client_requests enable row level security;

grant select, insert, update on public.users to authenticated;
grant select, insert, update on public.groups to authenticated;
grant select, insert, update on public.group_members to authenticated;
grant select, insert, update on public.invites to authenticated;
grant select, insert, update on public.expenses to authenticated;
grant select, insert, update on public.expense_payments to authenticated;
grant select, insert, update on public.expense_shares to authenticated;
grant select, insert, update on public.settlements to authenticated;
grant select, insert, update on public.settlement_transfers to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select, insert on public.client_requests to authenticated;

create policy "users_select_self" on public.users
  for select to authenticated
  using ((select auth.uid())::text = id::text);

create policy "users_insert_authenticated" on public.users
  for insert to authenticated
  with check (true);

create policy "users_update_self" on public.users
  for update to authenticated
  using ((select auth.uid())::text = id::text)
  with check ((select auth.uid())::text = id::text);

create policy "groups_select_member" on public.groups
  for select to authenticated
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create policy "groups_insert_authenticated" on public.groups
  for insert to authenticated
  with check (true);

create policy "groups_update_member" on public.groups
  for update to authenticated
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.group_members
      where group_members.group_id = groups.id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create policy "group_members_select_same_group" on public.group_members
  for select to authenticated
  using (
    exists (
      select 1 from public.group_members viewer
      where viewer.group_id = group_members.group_id
        and viewer.user_id::text = (select auth.uid())::text
        and viewer.status = 'active'
    )
  );

create policy "group_members_insert_authenticated" on public.group_members
  for insert to authenticated
  with check (true);

create policy "group_members_update_same_group" on public.group_members
  for update to authenticated
  using (
    user_id is null
    or exists (
      select 1 from public.group_members viewer
      where viewer.group_id = group_members.group_id
        and viewer.user_id::text = (select auth.uid())::text
        and viewer.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.group_members viewer
      where viewer.group_id = group_members.group_id
        and viewer.user_id::text = (select auth.uid())::text
        and viewer.status = 'active'
    )
  );

create policy "invites_select_group_member" on public.invites
  for select to authenticated
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = invites.group_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create policy "invites_insert_group_member" on public.invites
  for insert to authenticated
  with check (
    exists (
      select 1 from public.group_members
      where group_members.group_id = invites.group_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create policy "client_requests_select_group_member" on public.client_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = client_requests.group_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create policy "client_requests_insert_group_member" on public.client_requests
  for insert to authenticated
  with check (
    exists (
      select 1 from public.group_members
      where group_members.group_id = client_requests.group_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create or replace view public.group_member_balances
with (security_invoker = true)
as
with paid as (
  select
    e.group_id,
    ep.payer_member_id as member_id,
    ep.currency,
    sum(ep.amount_minor)::integer as paid_minor
  from public.expenses e
  join public.expense_payments ep on ep.expense_id = e.id
  where e.deleted_at is null
    and e.kind in ('expense', 'income')
  group by e.group_id, ep.payer_member_id, ep.currency
),
shared as (
  select
    e.group_id,
    es.member_id,
    e.currency,
    sum(es.amount_minor)::integer as shared_minor
  from public.expenses e
  join public.expense_shares es on es.expense_id = e.id
  where e.deleted_at is null
    and e.kind in ('expense', 'income')
  group by e.group_id, es.member_id, e.currency
),
transfers_out as (
  select
    e.group_id,
    ep.payer_member_id as member_id,
    ep.currency,
    sum(ep.amount_minor)::integer as transfer_out_minor
  from public.expenses e
  join public.expense_payments ep on ep.expense_id = e.id
  where e.deleted_at is null
    and e.kind = 'transfer'
  group by e.group_id, ep.payer_member_id, ep.currency
),
transfers_in as (
  select
    e.group_id,
    e.transfer_to_member_id as member_id,
    e.currency,
    sum(e.amount_minor)::integer as transfer_in_minor
  from public.expenses e
  where e.deleted_at is null
    and e.kind = 'transfer'
    and e.transfer_to_member_id is not null
  group by e.group_id, e.transfer_to_member_id, e.currency
),
member_currency as (
  select group_id, member_id, currency from paid
  union
  select group_id, member_id, currency from shared
  union
  select group_id, member_id, currency from transfers_out
  union
  select group_id, member_id, currency from transfers_in
)
select
  mc.group_id,
  mc.member_id,
  mc.currency,
  coalesce(paid.paid_minor, 0)
    - coalesce(shared.shared_minor, 0)
    - coalesce(transfers_out.transfer_out_minor, 0)
    + coalesce(transfers_in.transfer_in_minor, 0) as balance_minor
from member_currency mc
left join paid
  on paid.group_id = mc.group_id
  and paid.member_id = mc.member_id
  and paid.currency = mc.currency
left join shared
  on shared.group_id = mc.group_id
  and shared.member_id = mc.member_id
  and shared.currency = mc.currency
left join transfers_out
  on transfers_out.group_id = mc.group_id
  and transfers_out.member_id = mc.member_id
  and transfers_out.currency = mc.currency
left join transfers_in
  on transfers_in.group_id = mc.group_id
  and transfers_in.member_id = mc.member_id
  and transfers_in.currency = mc.currency;

grant select on public.group_member_balances to authenticated;
