-- 個人帳本首頁的「本月群組分攤」：把使用者在所有已加入共享群組裡，當月分到
-- 的支出份額（expense_shares），依群組彙總回來給 GET /api/v1/me/group-shares。
--
-- D1 (what counts as a group share):
--   - expenses.kind = 'expense' and deleted_at is null (settlements and
--     income are excluded outright - paying a friend back is not spending,
--     and a group's income row belongs to the collector, not the
--     beneficiary; see cloudAdapters.ts's expense_payments/expense_shares
--     encoding for why the latter can't be read as "my income").
--   - expense_date falls inside the requested month (p_month, a plain
--     calendar date - the client decides "the month", never this function).
--   - expenses.currency = groups.currency, the same guard
--     group_balances_for_user uses (20260804112607): money is always
--     recorded in the group's own currency, so this only ever excludes the
--     handful of legacy rows written before that was enforced.
--   - the group has kind = 'shared' and deleted_at is null. Archived groups
--     are still counted (see D1 in the plan - archiving mid-month must not
--     make 本月支出 drop), just not linkable from the client's group list.
--   - the caller's own membership is active (status = 'active'); a group the
--     caller left (status = 'removed') contributes nothing.
--   - the share amount is greater than 0.
--
-- D2 (currency): every group's shares come back in that group's own
-- currency. Deciding which of them can be added to a same-currency ledger
-- total is the client's job (combineLedgerMonth) - there is no stored
-- exchange rate to convert with here, and converting at today's rate would
-- make a past month's total drift with no new entry.
--
-- A bad p_month (fails the YYYY-MM check) makes `bounds` empty, which makes
-- `share_rows` empty, which makes `groups` an empty array rather than an
-- error - the handler validates the same pattern independently (defence in
-- depth), but this keeps the function itself total.
CREATE OR REPLACE FUNCTION public.personal_month_group_shares(p_user uuid, p_month text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  with bounds as (
    select to_date(p_month || '-01', 'YYYY-MM-DD') as month_start
     where p_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
  ),
  mine as (
    select m.id as member_id, g.id as group_id, g.name, g.currency, (g.archived_at is not null) as archived
      from group_members m
      join groups g on g.id = m.group_id and g.deleted_at is null and g.kind = 'shared'
     where m.user_id = p_user and m.status = 'active'
  ),
  share_rows as (
    select mi.group_id, coalesce(nullif(e.category, ''), 'general') as category, sh.amount_minor::bigint as amount_minor
      from mine mi
      cross join bounds b
      join expenses e on e.group_id = mi.group_id and e.deleted_at is null and e.kind = 'expense'
                     and e.currency = mi.currency
                     and e.expense_date >= b.month_start
                     and e.expense_date < (b.month_start + interval '1 month')::date
      join expense_shares sh on sh.expense_id = e.id and sh.member_id = mi.member_id
     where sh.amount_minor > 0
  ),
  per_category as (
    select group_id, category, sum(amount_minor)::bigint as share_minor, count(*)::int as n
      from share_rows group by group_id, category
  ),
  per_group as (
    select pc.group_id, sum(pc.share_minor)::bigint as share_minor, sum(pc.n)::int as expense_count,
           jsonb_agg(jsonb_build_object('category', pc.category, 'share_minor', pc.share_minor)
                     order by pc.share_minor desc) as by_category
      from per_category pc group by pc.group_id
  )
  select jsonb_build_object(
    'month', p_month,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'group_id', mi.group_id, 'name', mi.name, 'currency', mi.currency, 'archived', mi.archived,
               'share_minor', t.share_minor, 'expense_count', t.expense_count, 'by_category', t.by_category)
             order by t.share_minor desc, mi.name)
        -- distinct: nothing in the schema stops one user holding two active
        -- member rows in the same group; per_group already sums both, and this
        -- keeps that group from being listed twice.
        from (select distinct group_id, name, currency, archived from mine) mi
        join per_group t on t.group_id = mi.group_id), '[]'::jsonb));
$$;
ALTER FUNCTION public.personal_month_group_shares(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.personal_month_group_shares(uuid, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.personal_month_group_shares(uuid, text) TO service_role;
