drop policy if exists "users_insert_authenticated" on public.users;
create policy "users_insert_authenticated" on public.users
  for insert to authenticated
  with check ((select auth.uid())::text = id::text);

drop policy if exists "invites_select_group_member" on public.invites;
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

drop policy if exists "invites_insert_group_member" on public.invites;
create policy "invites_insert_group_member" on public.invites
  for insert to authenticated
  with check (
    exists (
      select 1 from public.group_members
      where group_members.group_id = invites.group_id
        and group_members.id = invites.created_by_member_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

drop policy if exists "settlement_transfers_select_group_member" on public.settlement_transfers;
create policy "settlement_transfers_select_group_member" on public.settlement_transfers
  for select to authenticated
  using (
    exists (
      select 1
      from public.settlements s
      join public.group_members gm on gm.group_id = s.group_id
      where s.id = settlement_transfers.settlement_id
        and gm.user_id::text = (select auth.uid())::text
        and gm.status = 'active'
    )
  );

drop policy if exists "settlement_transfers_insert_group_member" on public.settlement_transfers;
create policy "settlement_transfers_insert_group_member" on public.settlement_transfers
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.settlements s
      join public.group_members gm on gm.group_id = s.group_id
      where s.id = settlement_transfers.settlement_id
        and gm.user_id::text = (select auth.uid())::text
        and gm.status = 'active'
    )
  );

drop policy if exists "audit_logs_select_group_member" on public.audit_logs;
create policy "audit_logs_select_group_member" on public.audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.group_members
      where group_members.group_id = audit_logs.group_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

drop policy if exists "audit_logs_insert_group_member" on public.audit_logs;
create policy "audit_logs_insert_group_member" on public.audit_logs
  for insert to authenticated
  with check (
    exists (
      select 1 from public.group_members
      where group_members.group_id = audit_logs.group_id
        and group_members.id = audit_logs.actor_member_id
        and group_members.user_id::text = (select auth.uid())::text
        and group_members.status = 'active'
    )
  );

create index if not exists groups_owner_member_id_idx on public.groups(owner_member_id);
create index if not exists group_members_user_id_idx on public.group_members(user_id);
create index if not exists invites_group_id_idx on public.invites(group_id);
create index if not exists invites_created_by_member_id_idx on public.invites(created_by_member_id);
create index if not exists expenses_created_by_member_id_idx on public.expenses(created_by_member_id);
create index if not exists expenses_transfer_to_member_id_idx on public.expenses(transfer_to_member_id);
create index if not exists expense_payments_expense_id_idx on public.expense_payments(expense_id);
create index if not exists expense_payments_payer_member_id_idx on public.expense_payments(payer_member_id);
create index if not exists expense_shares_member_id_idx on public.expense_shares(member_id);
create index if not exists settlement_transfers_settlement_id_idx on public.settlement_transfers(settlement_id);
create index if not exists settlement_transfers_from_member_id_idx on public.settlement_transfers(from_member_id);
create index if not exists settlement_transfers_to_member_id_idx on public.settlement_transfers(to_member_id);
create index if not exists settlement_transfers_confirmed_expense_id_idx on public.settlement_transfers(confirmed_expense_id);
create index if not exists audit_logs_group_id_idx on public.audit_logs(group_id);
create index if not exists audit_logs_actor_member_id_idx on public.audit_logs(actor_member_id);
