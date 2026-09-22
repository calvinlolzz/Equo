-- Category scope, for the personal ledger's expense/income categories.
--
-- Scoped with a column on the existing catalog table rather than by key: the
-- data stays in one place, admin_console_save_category keeps its signature and
-- already preserves unknown columns on upsert (`do update set label, color,
-- sort_order, enabled, ...` - scope simply isn't touched by it), and a category
-- an admin adds later defaults to shared, which is the conservative choice.

ALTER TABLE public.expense_categories ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'shared';
ALTER TABLE public.expense_categories DROP CONSTRAINT IF EXISTS expense_categories_scope_check;
ALTER TABLE public.expense_categories
  ADD CONSTRAINT expense_categories_scope_check CHECK (scope IN ('shared', 'personal', 'income'));

INSERT INTO public.expense_categories (key, label, color, sort_order, scope) VALUES
  ('entertainment', '娛樂', '#F2B84B', 70, 'personal'),
  ('home', '居家', '#3FB6B2', 80, 'personal'),
  ('bills', '帳單', '#6B7FD7', 90, 'personal'),
  ('health', '醫療', '#E5646E', 100, 'personal'),
  ('education', '教育', '#A3C95A', 110, 'personal'),
  ('salary', '薪資', '#3DBE8B', 200, 'income'),
  ('bonus', '獎金', '#F0C24B', 210, 'income'),
  ('investment', '投資', '#5AA9E6', 220, 'income'),
  ('other_income', '其他收入', '#9AA8BC', 230, 'income')
ON CONFLICT (key) DO NOTHING;

-- Both catalog-reading functions restated in full (they're short - see
-- 20260805120000_app_catalog.sql:132-150, :154-202) with 'scope' added
-- alongside the fields each already returns per category.

CREATE OR REPLACE FUNCTION "public"."app_catalog"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'color', c.color, 'scope', c.scope) order by c.sort_order, c.key)
      from expense_categories c where c.enabled
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label) order by c.sort_order, c.code)
      from app_currencies c where c.enabled
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."app_catalog"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."app_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_catalog"() TO "service_role";

CREATE OR REPLACE FUNCTION "public"."admin_console_catalog"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', c.key,
        'label', c.label,
        'color', c.color,
        'sort_order', c.sort_order,
        'enabled', c.enabled,
        'scope', c.scope,
        'updated_at', c.updated_at,
        'updated_by_email', c.updated_by_email,
        -- How many live expenses would be affected by a change. The number that
        -- decides whether disabling a category is harmless or disruptive.
        'expense_count', (select count(*) from expenses e where e.category = c.key and e.deleted_at is null)
      ) order by c.sort_order, c.key)
      from expense_categories c
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code,
        'label', c.label,
        'sort_order', c.sort_order,
        'enabled', c.enabled,
        'updated_at', c.updated_at,
        'updated_by_email', c.updated_by_email,
        'expense_count', (select count(*) from expenses e where e.currency = c.code and e.deleted_at is null)
      ) order by c.sort_order, c.code)
      from app_currencies c
    ), '[]'::jsonb),
    'rate_overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'base', o.base,
        'quote', o.quote,
        'rate', o.rate,
        'note', o.note,
        'updated_at', o.updated_at,
        'updated_by_email', o.updated_by_email
      ) order by o.base, o.quote)
      from exchange_rate_overrides o
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_catalog"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_catalog"() TO "service_role";
