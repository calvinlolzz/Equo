-- Master data: the lists the app renders itself from.
--
-- The expense categories, the currency picker's options and the exchange rates
-- were all fixed in the client bundle (UI_TEXT.categories, App.tsx's
-- currencyOptions, CategoryDonut's palette). Adding 醫療 or turning on SGD -
-- changes with no logic behind them at all - meant a code change, a review and
-- a deploy, and the exchange rate had no manual path whatsoever: when the
-- upstream had no quote for a pair, the composer simply fell back to typing the
-- number in by hand, forever.
--
-- Two deliberate limits:
--
--   * a category is DISABLED, never deleted. expenses.category holds the key as
--     text, so removing a row would leave live rows pointing at a label nobody
--     can render. Disabled means "not offered on new expenses"; existing ones
--     keep their name.
--   * a rate override is a fact with an author, not a setting. It is scoped to
--     one currency pair, carries a note, and the console shows who last touched
--     it - because a wrong number here quietly changes what people think they
--     owe each other.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."expense_categories" (
    -- The value stored in expenses.category. Immutable once used: renaming the
    -- KEY would orphan rows, which is what `label` is for.
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    -- Hex, used by the analysis donut. The palette used to live in the
    -- component, which meant a new category had no colour until someone
    -- remembered to add one.
    "color" "text" DEFAULT '#93A0B5'::"text" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by_email" "text",
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "expense_categories_color_check" CHECK (("color" ~* '^#[0-9a-f]{6}$'))
);

ALTER TABLE "public"."expense_categories" OWNER TO "postgres";
ALTER TABLE "public"."expense_categories" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."expense_categories" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."expense_categories" FROM "anon";
REVOKE ALL ON TABLE "public"."expense_categories" FROM "authenticated";
GRANT ALL ON TABLE "public"."expense_categories" TO "service_role";

-- Seeded with exactly what the bundle shipped, so the first deploy after this
-- migration renders identically and the table is a starting point rather than a
-- migration everyone has to notice.
INSERT INTO "public"."expense_categories" ("key", "label", "color", "sort_order") VALUES
  ('food', '餐飲', '#F0885A', 10),
  ('transport', '交通', '#5B9BF0', 20),
  ('lodging', '住宿', '#8E7CF0', 30),
  ('shopping', '購物', '#EC6FA6', 40),
  ('general', '一般', '#4FC59A', 50),
  ('other', '其他', '#93A0B5', 60)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Currencies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."app_currencies" (
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by_email" "text",
    CONSTRAINT "app_currencies_pkey" PRIMARY KEY ("code"),
    -- ISO 4217 shape. Not a list of valid codes: the point of this table is
    -- that adding one does not need a deploy, and it would not need a
    -- migration either.
    CONSTRAINT "app_currencies_code_check" CHECK (("code" ~ '^[A-Z]{3}$'))
);

ALTER TABLE "public"."app_currencies" OWNER TO "postgres";
ALTER TABLE "public"."app_currencies" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."app_currencies" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."app_currencies" FROM "anon";
REVOKE ALL ON TABLE "public"."app_currencies" FROM "authenticated";
GRANT ALL ON TABLE "public"."app_currencies" TO "service_role";

INSERT INTO "public"."app_currencies" ("code", "label", "sort_order") VALUES
  ('TWD', '新台幣', 10),
  ('JPY', '日圓', 20),
  ('USD', '美元', 30),
  ('KRW', '韓元', 40),
  ('EUR', '歐元', 50)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Exchange rate overrides
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."exchange_rate_overrides" (
    "base" "text" NOT NULL,
    "quote" "text" NOT NULL,
    -- Units of quote per 1 base, matching the upstream feed's direction and the
    -- composer's field.
    "rate" numeric(18,8) NOT NULL,
    -- Why this number. A rate with no reason attached is unauditable six months
    -- later, and this is the one table here that can move money.
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by_email" "text",
    CONSTRAINT "exchange_rate_overrides_pkey" PRIMARY KEY ("base", "quote"),
    CONSTRAINT "exchange_rate_overrides_rate_check" CHECK (("rate" > (0)::numeric)),
    CONSTRAINT "exchange_rate_overrides_pair_check" CHECK (("base" <> "quote"))
);

ALTER TABLE "public"."exchange_rate_overrides" OWNER TO "postgres";
ALTER TABLE "public"."exchange_rate_overrides" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."exchange_rate_overrides" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."exchange_rate_overrides" FROM "anon";
REVOKE ALL ON TABLE "public"."exchange_rate_overrides" FROM "authenticated";
GRANT ALL ON TABLE "public"."exchange_rate_overrides" TO "service_role";

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- What the app renders from: enabled rows only, in display order.
--
-- Rate overrides are NOT here. They are applied server-side on top of the
-- upstream quotes (see the exchange-rate route), so the client never has to
-- know that a number was manual - and a client that fetched both would have to
-- reimplement the merge.
CREATE OR REPLACE FUNCTION "public"."app_catalog"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'color', c.color) order by c.sort_order, c.key)
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

-- The console's view: every row including the disabled ones, plus the rate
-- overrides and who last touched each thing.
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

-- The overrides for one base currency, as a { quote: rate } object - the shape
-- the rate route merges over the upstream's own map.
CREATE OR REPLACE FUNCTION "public"."exchange_rate_overrides_for"("p_base" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_object_agg(o.quote, o.rate), '{}'::jsonb)
  from exchange_rate_overrides o
  where o.base = p_base;
$$;

ALTER FUNCTION "public"."exchange_rate_overrides_for"("p_base" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."exchange_rate_overrides_for"("p_base" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."exchange_rate_overrides_for"("p_base" "text") TO "service_role";

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Create or update one category. The key is the identity, so this is an upsert
-- and there is no rename: changing a key would orphan every expense holding it.
CREATE OR REPLACE FUNCTION "public"."admin_console_save_category"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_key" "text",
  "p_label" "text",
  "p_color" "text",
  "p_sort_order" integer,
  "p_enabled" boolean
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_key text := lower(btrim(p_key));
  v_row expense_categories%rowtype;
  v_existed boolean;
begin
  if v_key !~ '^[a-z][a-z0-9_]{0,30}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_KEY');
  end if;

  if btrim(coalesce(p_label, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LABEL');
  end if;

  if p_color !~* '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_COLOR');
  end if;

  select exists (select 1 from expense_categories where key = v_key) into v_existed;

  insert into expense_categories (key, label, color, sort_order, enabled, updated_at, updated_by_email)
  values (v_key, btrim(p_label), lower(p_color), coalesce(p_sort_order, 100), coalesce(p_enabled, true), now(), p_actor_email)
  on conflict (key) do update
    set label = excluded.label,
        color = excluded.color,
        sort_order = excluded.sort_order,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by_email = excluded.updated_by_email
  returning * into v_row;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'catalog.category',
    jsonb_build_object('key', v_row.key, 'label', v_row.label, 'enabled', v_row.enabled, 'created', not v_existed)
  );

  return jsonb_build_object(
    'ok', true,
    'category', jsonb_build_object(
      'key', v_row.key,
      'label', v_row.label,
      'color', v_row.color,
      'sort_order', v_row.sort_order,
      'enabled', v_row.enabled
    )
  );
end
$$;

ALTER FUNCTION "public"."admin_console_save_category"("p_actor" "uuid", "p_actor_email" "text", "p_key" "text", "p_label" "text", "p_color" "text", "p_sort_order" integer, "p_enabled" boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_save_category"("p_actor" "uuid", "p_actor_email" "text", "p_key" "text", "p_label" "text", "p_color" "text", "p_sort_order" integer, "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_save_category"("p_actor" "uuid", "p_actor_email" "text", "p_key" "text", "p_label" "text", "p_color" "text", "p_sort_order" integer, "p_enabled" boolean) TO "service_role";

CREATE OR REPLACE FUNCTION "public"."admin_console_save_currency"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_code" "text",
  "p_label" "text",
  "p_sort_order" integer,
  "p_enabled" boolean
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_code text := upper(btrim(p_code));
  v_row app_currencies%rowtype;
begin
  if v_code !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if btrim(coalesce(p_label, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LABEL');
  end if;

  -- A currency still carried by live expenses cannot be withdrawn: the amounts
  -- stay denominated in it, and the app would have no label to render them
  -- with. Disabling the last one people actually use is the sort of change
  -- that looks harmless in a form.
  if coalesce(p_enabled, true) = false
     and exists (select 1 from expenses where currency = v_code and deleted_at is null) then
    return jsonb_build_object('ok', false, 'error', 'CURRENCY_IN_USE');
  end if;

  insert into app_currencies (code, label, sort_order, enabled, updated_at, updated_by_email)
  values (v_code, btrim(p_label), coalesce(p_sort_order, 100), coalesce(p_enabled, true), now(), p_actor_email)
  on conflict (code) do update
    set label = excluded.label,
        sort_order = excluded.sort_order,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by_email = excluded.updated_by_email
  returning * into v_row;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'catalog.currency',
    jsonb_build_object('code', v_row.code, 'label', v_row.label, 'enabled', v_row.enabled)
  );

  return jsonb_build_object(
    'ok', true,
    'currency', jsonb_build_object(
      'code', v_row.code,
      'label', v_row.label,
      'sort_order', v_row.sort_order,
      'enabled', v_row.enabled
    )
  );
end
$$;

ALTER FUNCTION "public"."admin_console_save_currency"("p_actor" "uuid", "p_actor_email" "text", "p_code" "text", "p_label" "text", "p_sort_order" integer, "p_enabled" boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_save_currency"("p_actor" "uuid", "p_actor_email" "text", "p_code" "text", "p_label" "text", "p_sort_order" integer, "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_save_currency"("p_actor" "uuid", "p_actor_email" "text", "p_code" "text", "p_label" "text", "p_sort_order" integer, "p_enabled" boolean) TO "service_role";

-- Set or clear one pair's manual rate. p_rate NULL clears it, which is how the
-- pair goes back to following the upstream.
CREATE OR REPLACE FUNCTION "public"."admin_console_set_rate_override"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_base" "text",
  "p_quote" "text",
  "p_rate" numeric,
  "p_note" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_base text := upper(btrim(p_base));
  v_quote text := upper(btrim(p_quote));
begin
  if v_base !~ '^[A-Z]{3}$' or v_quote !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if v_base = v_quote then
    return jsonb_build_object('ok', false, 'error', 'SAME_CURRENCY');
  end if;

  if p_rate is null then
    delete from exchange_rate_overrides where base = v_base and quote = v_quote;

    insert into admin_audit_logs (admin_id, admin_email, action, metadata)
    values (p_actor, p_actor_email, 'catalog.rate_clear', jsonb_build_object('base', v_base, 'quote', v_quote));

    return jsonb_build_object('ok', true, 'cleared', true, 'base', v_base, 'quote', v_quote);
  end if;

  if p_rate <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RATE');
  end if;

  insert into exchange_rate_overrides (base, quote, rate, note, updated_at, updated_by_email)
  values (v_base, v_quote, p_rate, nullif(btrim(coalesce(p_note, '')), ''), now(), p_actor_email)
  on conflict (base, quote) do update
    set rate = excluded.rate,
        note = excluded.note,
        updated_at = excluded.updated_at,
        updated_by_email = excluded.updated_by_email;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'catalog.rate_set',
    jsonb_build_object('base', v_base, 'quote', v_quote, 'rate', p_rate)
  );

  return jsonb_build_object('ok', true, 'cleared', false, 'base', v_base, 'quote', v_quote, 'rate', p_rate);
end
$$;

ALTER FUNCTION "public"."admin_console_set_rate_override"("p_actor" "uuid", "p_actor_email" "text", "p_base" "text", "p_quote" "text", "p_rate" numeric, "p_note" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_set_rate_override"("p_actor" "uuid", "p_actor_email" "text", "p_base" "text", "p_quote" "text", "p_rate" numeric, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_rate_override"("p_actor" "uuid", "p_actor_email" "text", "p_base" "text", "p_quote" "text", "p_rate" numeric, "p_note" "text") TO "service_role";
