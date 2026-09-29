-- LINE bot: 「預算」 commands - set or clear the personal ledger's monthly budget.
-- Same posture as 20260929090000_line_bot.sql: NO group parameter (the ledger
-- comes only from ensure_personal_ledger), SECURITY DEFINER, pinned
-- search_path, service_role only. Idempotent by value: no event-id table; a
-- no-op write does not touch updated_at. Viewing reuses line_month_summary.

CREATE OR REPLACE FUNCTION "public"."line_set_budget"(
  "p_line_user_id" text,
  "p_budget_minor" integer,
  "p_month_start" date
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_ledger jsonb;
  v_group uuid;
  v_currency text;
  v_budget integer;
begin
  -- Same range as handleUpdateGroup's validateMonthlyBudgetMinor and the
  -- groups_monthly_budget_positive CHECK. NULL clears.
  if p_month_start is null
     or (p_budget_minor is not null and not (p_budget_minor > 0 and p_budget_minor <= 2000000000)) then
    raise exception 'LINE_INVALID_BUDGET';
  end if;

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

  update groups
     set monthly_budget_minor = p_budget_minor, updated_at = now()
   where id = v_group and kind = 'personal' and deleted_at is null
     and monthly_budget_minor is distinct from p_budget_minor;

  select monthly_budget_minor into v_budget from groups where id = v_group;

  update line_accounts set last_used_at = now() where line_user_id = p_line_user_id;

  return jsonb_build_object(
    'ok', true,
    'ledger_id', v_group,
    'currency', v_currency,
    'budget_minor', v_budget,
    'month', line_ledger_month_totals(v_group, v_currency, p_month_start)
  );
end
$$;

ALTER FUNCTION "public"."line_set_budget"(text, integer, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_set_budget"(text, integer, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_set_budget"(text, integer, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_set_budget"(text, integer, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_set_budget"(text, integer, date) TO "service_role";
