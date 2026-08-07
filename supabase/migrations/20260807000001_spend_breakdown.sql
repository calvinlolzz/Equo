-- 分析頁的時間區段統計。
--
-- Why this has to be a server function at all: the client only ever holds the
-- newest p_expense_limit (100) expenses, and the aggregates get_group_detail
-- ships alongside them are either all-time (spend_by_category) or a trailing
-- 8-day window (spend_by_day). Neither can answer "2024 vs 2023", and folding
-- a year out of a 100-row window would quietly under-report the moment a group
-- gets busy.
--
-- Personal vs group: the group figure is the expense amount; the personal one
-- is the caller's own row in expense_shares. That column is NOT NULL and always
-- materialised (see cloudAdapters.ts - shareAmountsMinor is always rebuilt from
-- expense_shares, even for an equal split), so summing it here matches
-- getMemberShareMinor's result exactly rather than re-deriving the split.
--
-- Currency is not summed across: expenses are always written in the group's
-- own currency (the composer converts and keeps the original in
-- source_currency), the same assumption group_balances_for_user makes.
CREATE OR REPLACE FUNCTION "public"."get_spend_breakdown"(
  "p_group_id" "uuid",
  "p_user_id" "uuid",
  "p_period_kind" "text" DEFAULT 'year',
  "p_period_key" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with caller as (
    select m.id as member_id
    from group_members m
    where m.group_id = p_group_id
      and m.user_id = p_user_id
      and m.status = 'active'
    limit 1
  ),
  -- Anything that is not 'month' means years, so an unknown value degrades to
  -- the default view instead of returning an empty page.
  grouping_kind as (
    select case when p_period_kind = 'month' then 'month' else 'year' end as kind
  ),
  spend as (
    select
      e.id,
      e.amount_minor,
      coalesce(nullif(e.category, ''), 'general') as category,
      to_char(
        e.expense_date,
        case when (select kind from grouping_kind) = 'month' then 'YYYY-MM' else 'YYYY' end
      ) as period_key
    from expenses e
    where e.group_id = p_group_id
      and e.deleted_at is null
      -- Mirrors isSpendableExpense: settlements move money between members and
      -- income is money received; neither is spending.
      and e.kind = 'expense'
      and e.amount_minor is not null
  ),
  -- The chip row. Capped so a decade-old group cannot hand the UI 120 months;
  -- the cap also bounds what p_period_key is allowed to select.
  periods as (
    select s.period_key, sum(s.amount_minor)::bigint as total_minor
    from spend s
    group by s.period_key
    order by s.period_key desc
    limit 36
  ),
  -- An unknown/absent p_period_key falls back to the newest period rather than
  -- erroring, so a client asking for a year the group has no spend in still
  -- renders something.
  selected as (
    select coalesce(
      (select p.period_key from periods p where p.period_key = p_period_key),
      (select p.period_key from periods p order by p.period_key desc limit 1)
    ) as period_key
  ),
  period_rows as (
    select
      s.category,
      s.amount_minor as group_minor,
      coalesce((
        select sum(sh.amount_minor)
        from expense_shares sh
        where sh.expense_id = s.id
          and sh.member_id = (select c.member_id from caller c)
      ), 0) as personal_minor
    from spend s
    where s.period_key = (select sel.period_key from selected sel)
  )
  select case
    when not exists (select 1 from caller) then null
    when not exists (select 1 from groups g where g.id = p_group_id and g.deleted_at is null) then null
    else jsonb_build_object(
      'period_kind', (select kind from grouping_kind),
      'period_key', (select sel.period_key from selected sel),
      'currency', (select g.currency from groups g where g.id = p_group_id),
      'periods', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('key', p.period_key, 'total_minor', p.total_minor)
            order by p.period_key desc
          ),
          '[]'::jsonb
        )
        from periods p
      ),
      'group_total_minor', (select coalesce(sum(r.group_minor), 0)::bigint from period_rows r),
      'personal_total_minor', (select coalesce(sum(r.personal_minor), 0)::bigint from period_rows r),
      'by_category', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'category', c.category,
              'group_total_minor', c.group_total_minor,
              'personal_total_minor', c.personal_total_minor
            )
            order by c.group_total_minor desc
          ),
          '[]'::jsonb
        )
        from (
          select
            r.category,
            sum(r.group_minor)::bigint as group_total_minor,
            sum(r.personal_minor)::bigint as personal_total_minor
          from period_rows r
          group by r.category
        ) c
      )
    )
  end;
$$;


ALTER FUNCTION "public"."get_spend_breakdown"("uuid", "uuid", "text", "text") OWNER TO "postgres";

-- PostgREST publishes every executable function under /rpc/, so the REVOKE is
-- what keeps this off the public API surface rather than a nicety.
REVOKE ALL ON FUNCTION "public"."get_spend_breakdown"("uuid", "uuid", "text", "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_spend_breakdown"("uuid", "uuid", "text", "text") TO "service_role";
