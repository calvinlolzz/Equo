-- get_group_detail v4: adds the 'spend_by_category' aggregate so the 分析
-- panel's category breakdown is server-authoritative (the expenses array is
-- windowed to p_expense_limit, so client-side totals would understate - same
-- rationale as spend_total_minor/spend_by_day in v3). Everything else is
-- unchanged from the deployed v3 definition.

create or replace function public.get_group_detail(p_group_id uuid, p_user_id uuid, p_expense_limit integer default 100)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
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
$function$;
