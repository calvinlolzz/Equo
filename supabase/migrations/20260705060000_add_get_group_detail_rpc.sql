-- Collapses the group-detail read (group + members + expenses with
-- payments/shares + balances) into a single RPC so opening a group is
-- one round trip instead of 4-6 sequential queries. Returns null when
-- the caller is not an active member or the group is deleted; executable
-- by the service role only (the API layer authenticates the user).
create or replace function public.get_group_detail(p_group_id uuid, p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
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
          'display_name', m.display_name, 'role', m.role, 'status', m.status
        )), '[]'::jsonb)
        from group_members m where m.group_id = p_group_id
      ),
      'expenses', (
        select coalesce(jsonb_agg(e_row.data order by e_row.expense_date desc, e_row.created_at desc), '[]'::jsonb)
        from (
          select e.expense_date, e.created_at, jsonb_build_object(
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
        ) e_row
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

revoke all on function public.get_group_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_group_detail(uuid, uuid) to service_role;
