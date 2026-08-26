-- 每月預算, and the numbers needed to say "more than last month".
--
-- The 分析 panel can already say what a period cost. What it cannot say is
-- whether that is a lot — and "a lot" only has two useful meanings: more than
-- you meant to spend, and more than last time. This adds the data for both.
--
-- Two parts, and only the second one needs a user to do anything:
--
--   * personal_total_minor on each period, so a period-over-period comparison
--     is correct on BOTH sides of the 個人／群組 toggle. Without it the delta
--     would be a group figure sitting under a personal headline, which is the
--     kind of wrong that looks right.
--   * groups.monthly_budget_minor, opt-in and null by default.
--
-- Monthly rather than per-period: a household keeping groceries under a number
-- is the case this serves, and "budget for 2026" is not a thing anyone sets. The
-- panel only shows progress while the bucketing is 月.


-- ============================================================
-- The budget.
-- ============================================================
--
-- Minor units like every other amount here, in the group's own currency (a
-- group has exactly one, and every total on this panel is already in it).
-- NULL means unset, which is different from 0 — zero would be a budget of
-- nothing, and rendering "0% of NT$0" is not a feature.
ALTER TABLE "public"."groups"
  ADD COLUMN IF NOT EXISTS "monthly_budget_minor" integer;

ALTER TABLE "public"."groups"
  DROP CONSTRAINT IF EXISTS "groups_monthly_budget_positive";

ALTER TABLE "public"."groups"
  ADD CONSTRAINT "groups_monthly_budget_positive"
  CHECK ("monthly_budget_minor" IS NULL OR "monthly_budget_minor" > 0);


-- ============================================================
-- Personal totals per period.
-- ============================================================
--
-- Patching the live definition rather than restating 100+ lines; the anchors
-- are verified unique and a miss raises rather than silently shipping a
-- group-scoped delta under a personal heading.
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_spend_breakdown';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_spend_breakdown is missing; cannot add personal period totals';
  END IF;

  IF v_def LIKE '%personal_period%' THEN
    RETURN;
  END IF;

  -- 1. Carry the caller's share alongside the group total in the chip CTE.
  v_new := replace(
    v_def,
    $a$    select s.period_key, sum(s.amount_minor)::bigint as total_minor
    from spend s
    group by s.period_key$a$,
    $a$    select
      s.period_key,
      sum(s.amount_minor)::bigint as total_minor,
      -- personal_period: the caller's own share of the same bucket, so the
      -- period-over-period delta is right on both sides of the 個人／群組 tabs.
      sum(coalesce((
        select sum(sh.amount_minor)
        from expense_shares sh
        where sh.expense_id = s.id
          and sh.member_id = (select c.member_id from caller c)
      ), 0))::bigint as personal_total_minor
    from spend s
    group by s.period_key$a$
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'get_spend_breakdown: periods CTE anchor not found';
  END IF;

  -- 2. Emit it.
  v_def := v_new;
  v_new := replace(
    v_def,
    $a$jsonb_build_object('key', p.period_key, 'total_minor', p.total_minor)$a$,
    $a$jsonb_build_object('key', p.period_key, 'total_minor', p.total_minor, 'personal_total_minor', p.personal_total_minor)$a$
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'get_spend_breakdown: periods payload anchor not found';
  END IF;

  EXECUTE v_new;
END
$do$;
