-- LINE bot: per-category expense totals for the 「本月」 card.
--
-- line_ledger_month_categories sits beside line_ledger_month_totals
-- (20260929090000_line_bot.sql §7) with the SAME row filter - one ledger, one
-- currency, not deleted, inside the calendar month of p_month_start - plus
-- kind = 'expense'. Only line_month_summary carries it: line_record_entry and
-- line_set_budget replies never show a breakdown, so their hot paths are left
-- untouched.
--
-- Top p_limit (clamped 1..20) by amount, ties broken by category key so the
-- order is stable. Nothing past the limit is returned: the client derives
-- 「其餘分類」 as month.expense_minor - sum(categories), exact because both
-- helpers are evaluated in ONE return expression (same snapshot). An empty
-- category reads as 'general', the mapping get_spend_breakdown uses.
--
-- Same posture as every line_ function: SECURITY DEFINER, pinned search_path,
-- revoked from PUBLIC/anon/authenticated, service_role only. Still no group
-- parameter on anything a webhook calls.

CREATE OR REPLACE FUNCTION "public"."line_ledger_month_categories"(
  "p_group" uuid,
  "p_currency" text,
  "p_month_start" date,
  "p_limit" integer DEFAULT 5
) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('category', c.category, 'expense_minor', c.expense_minor)
      order by c.expense_minor desc, c.category asc
    ),
    '[]'::jsonb
  )
  from (
    select coalesce(nullif(e.category, ''), 'general') as category,
           sum(e.amount_minor)::bigint as expense_minor
    from expenses e
    where e.group_id = p_group and e.deleted_at is null and e.currency = p_currency
      and e.kind = 'expense'
      and e.expense_date >= date_trunc('month', p_month_start)::date
      and e.expense_date < (date_trunc('month', p_month_start) + interval '1 month')::date
    group by 1
    having coalesce(sum(e.amount_minor), 0) > 0
    order by 2 desc, 1 asc
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) c;
$$;

ALTER FUNCTION "public"."line_ledger_month_categories"(uuid, text, date, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_ledger_month_categories"(uuid, text, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_ledger_month_categories"(uuid, text, date, integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_ledger_month_categories"(uuid, text, date, integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_ledger_month_categories"(uuid, text, date, integer) TO "service_role";

-- line_month_summary: identical to 20260929090000_line_bot.sql §10 except for
-- the 'categories' key (pinned by lineMigrationSql.test.ts).
CREATE OR REPLACE FUNCTION "public"."line_month_summary"("p_line_user_id" text, "p_month_start" date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_ledger jsonb;
  v_group uuid;
  v_currency text;
begin
  select la.user_id, u.deleted_at into v_user, v_deleted_at
  from line_accounts la
  join users u on u.id = la.user_id
  where la.line_user_id = p_line_user_id;

  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  if v_deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_disabled');
  end if;

  v_ledger := ensure_personal_ledger(v_user);

  if v_ledger is null then
    return jsonb_build_object('ok', false, 'reason', 'no_ledger');
  end if;

  v_group := (v_ledger ->> 'id')::uuid;
  v_currency := v_ledger ->> 'currency';

  -- Both helpers in ONE expression: one snapshot, so the categories can never
  -- add up to more than month.expense_minor.
  return jsonb_build_object(
    'ok', true,
    'ledger_id', v_group,
    'currency', v_currency,
    'budget_minor', v_ledger -> 'monthly_budget_minor',
    'month', line_ledger_month_totals(v_group, v_currency, p_month_start),
    'categories', line_ledger_month_categories(v_group, v_currency, p_month_start, 5)
  );
end
$$;

ALTER FUNCTION "public"."line_month_summary"(text, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_month_summary"(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_month_summary"(text, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_month_summary"(text, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_month_summary"(text, date) TO "service_role";
