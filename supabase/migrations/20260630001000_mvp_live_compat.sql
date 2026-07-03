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

alter table public.groups add column if not exists currency text;
update public.groups
set currency = coalesce(currency, base_currency, 'TWD')
where currency is null;
alter table public.groups alter column currency set default 'TWD';
alter table public.groups alter column currency set not null;
alter table public.groups add column if not exists owner_member_id uuid;
alter table public.groups add column if not exists deleted_at timestamptz;

alter table public.group_members add column if not exists status text;
update public.group_members set status = 'active' where status is null;
alter table public.group_members alter column status set default 'active';
alter table public.group_members alter column status set not null;
alter table public.group_members add column if not exists claimed_at timestamptz;
alter table public.group_members add column if not exists created_at timestamptz not null default now();
alter table public.group_members add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'group_members_role_check'
      and conrelid = 'public.group_members'::regclass
  ) then
    alter table public.group_members drop constraint group_members_role_check;
  end if;
end $$;

alter table public.group_members
  add constraint group_members_role_check
  check (role in ('owner', 'admin', 'parent', 'child', 'member', 'guest'));

alter table public.group_members
  drop constraint if exists group_members_status_check;
alter table public.group_members
  add constraint group_members_status_check
  check (status in ('active', 'removed'));

update public.groups g
set owner_member_id = gm.id
from public.group_members gm
where g.owner_member_id is null
  and gm.group_id = g.id
  and gm.user_id = g.owner_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'groups_owner_member_id_fkey'
      and conrelid = 'public.groups'::regclass
  ) then
    alter table public.groups
      add constraint groups_owner_member_id_fkey
      foreign key (owner_member_id) references public.group_members(id) on delete set null;
  end if;
end $$;

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

alter table public.expenses add column if not exists created_by_member_id uuid references public.group_members(id) on delete restrict;
alter table public.expenses add column if not exists kind text;
update public.expenses set kind = 'expense' where kind is null;
alter table public.expenses alter column kind set default 'expense';
alter table public.expenses alter column kind set not null;
alter table public.expenses add column if not exists amount_minor integer;
update public.expenses
set amount_minor = greatest(round(amount * 100)::integer, 1)
where amount_minor is null
  and amount is not null;
alter table public.expenses add column if not exists transfer_to_member_id uuid references public.group_members(id) on delete restrict;
alter table public.expenses add column if not exists version integer not null default 1;
alter table public.expenses add column if not exists deleted_at timestamptz;
alter table public.expenses add column if not exists client_request_id text;
update public.expenses
set client_request_id = coalesce(client_request_id, id::text)
where client_request_id is null;
alter table public.expenses alter column amount drop not null;
alter table public.expenses alter column payer_id drop not null;
alter table public.expenses alter column created_by drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_kind_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_kind_check
      check (kind in ('expense', 'income', 'transfer'));
  end if;
end $$;

create unique index if not exists expenses_group_client_request_id_key
  on public.expenses(group_id, client_request_id)
  where client_request_id is not null;

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

alter table public.settlements add column if not exists settlement_version integer;
alter table public.settlements add column if not exists calculated_version integer;
alter table public.settlements add column if not exists created_by_member_id uuid references public.group_members(id) on delete restrict;
alter table public.settlements add column if not exists superseded_at timestamptz;
alter table public.settlements alter column from_user_id drop not null;
alter table public.settlements alter column to_user_id drop not null;
alter table public.settlements alter column amount drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'settlements_status_check'
      and conrelid = 'public.settlements'::regclass
  ) then
    alter table public.settlements drop constraint settlements_status_check;
  end if;
end $$;

alter table public.settlements
  add constraint settlements_status_check
  check (status in ('draft', 'confirmed', 'superseded', 'unpaid', 'paid', 'cancelled'));

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

create policy "expense_payments_select_group_member" on public.expense_payments
  for select to authenticated
  using (
    exists (
      select 1
      from public.expenses e
      join public.group_members gm on gm.group_id = e.group_id
      where e.id = expense_payments.expense_id
        and gm.user_id::text = (select auth.uid())::text
        and gm.status = 'active'
    )
  );

create policy "expense_payments_insert_group_member" on public.expense_payments
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.expenses e
      join public.group_members gm on gm.group_id = e.group_id
      where e.id = expense_payments.expense_id
        and gm.user_id::text = (select auth.uid())::text
        and gm.status = 'active'
    )
  );

create policy "expense_shares_select_group_member" on public.expense_shares
  for select to authenticated
  using (
    exists (
      select 1
      from public.expenses e
      join public.group_members gm on gm.group_id = e.group_id
      where e.id = expense_shares.expense_id
        and gm.user_id::text = (select auth.uid())::text
        and gm.status = 'active'
    )
  );

create policy "expense_shares_insert_group_member" on public.expense_shares
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.expenses e
      join public.group_members gm on gm.group_id = e.group_id
      where e.id = expense_shares.expense_id
        and gm.user_id::text = (select auth.uid())::text
        and gm.status = 'active'
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
