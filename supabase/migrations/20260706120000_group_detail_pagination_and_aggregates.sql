-- get_group_detail v3: expenses are capped (default 100 newest) and the
-- payload carries server-authoritative aggregates so the client no longer
-- needs the full expense history to show correct numbers:
--   expense_count      - all non-deleted entries (for load-more paging UI)
--   spend_total_minor  - sum of kind='expense' amounts (excludes income/transfer)
--   spend_by_day       - last 8 days of kind='expense' totals [{day,total_minor}]
--   member_day_shares  - last 8 days of per-member expense shares
--                        [{day,member_id,share_minor}] (personal-spend tab)
create or replace function public.get_group_detail(
  p_group_id uuid,
  p_user_id uuid,
  p_expense_limit integer default 100
)
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

revoke all on function public.get_group_detail(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_group_detail(uuid, uuid, integer) to service_role;

-- The two-arg signature from earlier migrations is superseded.
drop function if exists public.get_group_detail(uuid, uuid);
