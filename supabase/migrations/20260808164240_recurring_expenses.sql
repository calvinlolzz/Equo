-- 循環支出：房租、水電、網路、管理費這種每月重打一次的帳。
--
-- 範圍（v1 刻意收窄）：每月一次、單一付款人、參與者平均分攤。真實資料裡
-- 的固定開銷（天然氣／水費／電費／房屋稅／網路費／管理費）全都是這個形狀。
-- 多付款人與自訂比例留給一次性支出的表單，不在這裡重造一套分攤模型。
--
-- day_of_month 限制在 1..28：29-31 號在二月不存在，而「當月最後一天」與
-- 「第 29 天」是兩種不同的語意，猜錯會讓人的房租日每年跳一次。要支援月底
-- 就該另外加一個明確的 last_day 旗標，而不是把 31 悄悄夾成 28。
CREATE TABLE IF NOT EXISTS "public"."recurring_expenses" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "group_id" "uuid" NOT NULL,
  -- 展開時要以「某個人」的身分寫入支出（create_expense 用 user_id 反查
  -- member）。存 user_id 而非 member_id，是因為 member 可能被改名或重建，
  -- 而建立這條規則的帳號才是它的擁有者。
  "owner_user_id" "uuid" NOT NULL,
  "title" "text" NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" "text" DEFAULT 'TWD'::"text" NOT NULL,
  "category" "text" DEFAULT 'other'::"text" NOT NULL,
  "note" "text",
  "payer_member_id" "uuid" NOT NULL,
  "share_member_ids" "uuid"[] NOT NULL,
  "day_of_month" integer NOT NULL,
  -- 下一次該產生的日期；展開後往前推一個月。
  "next_run_date" "date" NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  -- 展開失敗的原因（例如建立者已離開群組）。停用而非無限重試，並留下字串
  -- 讓 UI 能說明為什麼這條規則停了。
  "last_error" "text",
  "last_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_expenses_amount_check" CHECK (("amount_minor" > 0)),
  CONSTRAINT "recurring_expenses_day_check" CHECK (("day_of_month" >= 1) AND ("day_of_month" <= 28)),
  CONSTRAINT "recurring_expenses_shares_check" CHECK (("array_length"("share_member_ids", 1) >= 1)),
  CONSTRAINT "recurring_expenses_group_fk" FOREIGN KEY ("group_id")
    REFERENCES "public"."groups"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."recurring_expenses" OWNER TO "postgres";

-- 展開作業每晚只問一個問題：有哪些到期了。
CREATE INDEX IF NOT EXISTS "recurring_expenses_due_idx"
  ON "public"."recurring_expenses" USING "btree" ("next_run_date")
  WHERE ("active" = true);

CREATE INDEX IF NOT EXISTS "recurring_expenses_group_idx"
  ON "public"."recurring_expenses" USING "btree" ("group_id");

-- 前端角色對資料表沒有任何權限（見 20260714 的 REVOKE），一律走 service_role。
GRANT ALL ON TABLE "public"."recurring_expenses" TO "service_role";


-- ============================================================
-- 讀取
-- ============================================================
CREATE OR REPLACE FUNCTION "public"."list_recurring_expenses"("p_group_id" "uuid", "p_user_id" "uuid")
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when not exists (
      select 1 from group_members gm
      where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.status = 'active'
    ) then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'group_id', r.group_id,
        'title', r.title,
        'amount_minor', r.amount_minor,
        'currency', r.currency,
        'category', r.category,
        'note', r.note,
        'payer_member_id', r.payer_member_id,
        'share_member_ids', to_jsonb(r.share_member_ids),
        'day_of_month', r.day_of_month,
        'next_run_date', r.next_run_date,
        'active', r.active,
        'last_error', r.last_error,
        'last_run_at', r.last_run_at
      ) order by r.active desc, r.next_run_date, r.title)
      from recurring_expenses r
      where r.group_id = p_group_id
    ), '[]'::jsonb)
  end;
$$;

ALTER FUNCTION "public"."list_recurring_expenses"("uuid", "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_recurring_expenses"("uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_recurring_expenses"("uuid", "uuid") TO "service_role";


-- ============================================================
-- 建立／修改
-- ============================================================
--
-- p_id 為 null 時建立，否則就地更新。成員 id 一律驗證屬於本群組且 active，
-- 與 create_expense 同一條規則——否則一條指向已移除成員的規則會每個月安靜地
-- 失敗一次。
CREATE OR REPLACE FUNCTION "public"."upsert_recurring_expense"(
  "p_group_id" "uuid",
  "p_user_id" "uuid",
  "p_payload" "jsonb"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_day int := (p_payload ->> 'day_of_month')::int;
  v_shares uuid[];
  v_payer uuid := (p_payload ->> 'payer_member_id')::uuid;
  v_invalid uuid;
  v_next date;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  select array_agg(value::uuid) into v_shares
  from jsonb_array_elements_text(coalesce(p_payload -> 'share_member_ids', '[]'::jsonb));

  if v_shares is null or array_length(v_shares, 1) is null then
    raise exception 'INVALID_SHARES';
  end if;

  if v_day is null or v_day < 1 or v_day > 28 then
    raise exception 'INVALID_DAY_OF_MONTH';
  end if;

  select referenced.member_id into v_invalid
  from (
    select v_payer as member_id
    union all
    select unnest(v_shares)
  ) referenced
  where referenced.member_id is not null
    and not exists (
      select 1 from group_members gm
      where gm.id = referenced.member_id and gm.group_id = p_group_id and gm.status = 'active'
    )
  limit 1;

  if v_invalid is not null then
    raise exception 'INVALID_MEMBER:%', v_invalid;
  end if;

  -- 下一次執行日：本月的那一天若還沒過就是本月，否則下個月。用 make_date
  -- 而非字串拼接，時區問題留給呼叫端的 current_date。
  v_next := make_date(extract(year from current_date)::int, extract(month from current_date)::int, v_day);
  if v_next < current_date then
    v_next := (v_next + interval '1 month')::date;
  end if;

  if v_id is null then
    insert into recurring_expenses (
      group_id, owner_user_id, title, amount_minor, currency, category, note,
      payer_member_id, share_member_ids, day_of_month, next_run_date
    ) values (
      p_group_id, p_user_id,
      p_payload ->> 'title',
      (p_payload ->> 'amount_minor')::integer,
      coalesce(nullif(p_payload ->> 'currency', ''), 'TWD'),
      coalesce(nullif(p_payload ->> 'category', ''), 'other'),
      nullif(p_payload ->> 'note', ''),
      v_payer, v_shares, v_day, v_next
    )
    returning id into v_id;
  else
    update recurring_expenses r set
      title = p_payload ->> 'title',
      amount_minor = (p_payload ->> 'amount_minor')::integer,
      currency = coalesce(nullif(p_payload ->> 'currency', ''), 'TWD'),
      category = coalesce(nullif(p_payload ->> 'category', ''), 'other'),
      note = nullif(p_payload ->> 'note', ''),
      payer_member_id = v_payer,
      share_member_ids = v_shares,
      day_of_month = v_day,
      -- 改了日期就重算下一次；沒改就保持原本的排程，免得每次編輯金額都把
      -- 這個月的帳重新排一次。
      next_run_date = case when r.day_of_month <> v_day then v_next else r.next_run_date end,
      active = coalesce((p_payload ->> 'active')::boolean, r.active),
      -- 使用者動過它，先前的失敗原因就不再適用。
      last_error = null,
      updated_at = now()
    where r.id = v_id and r.group_id = p_group_id;

    if not found then
      raise exception 'RECURRING_NOT_FOUND';
    end if;
  end if;

  return (
    select jsonb_build_object(
      'id', r.id, 'group_id', r.group_id, 'title', r.title,
      'amount_minor', r.amount_minor, 'currency', r.currency, 'category', r.category,
      'note', r.note, 'payer_member_id', r.payer_member_id,
      'share_member_ids', to_jsonb(r.share_member_ids), 'day_of_month', r.day_of_month,
      'next_run_date', r.next_run_date, 'active', r.active,
      'last_error', r.last_error, 'last_run_at', r.last_run_at
    )
    from recurring_expenses r where r.id = v_id
  );
end;
$$;

ALTER FUNCTION "public"."upsert_recurring_expense"("uuid", "uuid", "jsonb") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."upsert_recurring_expense"("uuid", "uuid", "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_recurring_expense"("uuid", "uuid", "jsonb") TO "service_role";


-- ============================================================
-- 刪除
-- ============================================================
CREATE OR REPLACE FUNCTION "public"."delete_recurring_expense"(
  "p_group_id" "uuid", "p_user_id" "uuid", "p_id" "uuid"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted int;
begin
  if not exists (
    select 1 from group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.status = 'active'
  ) then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  -- 硬刪除：這是一條「以後要做什麼」的規則，不是帳。已經產生的支出留著，
  -- 它們是獨立的紀錄。
  delete from recurring_expenses r where r.id = p_id and r.group_id = p_group_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

ALTER FUNCTION "public"."delete_recurring_expense"("uuid", "uuid", "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."delete_recurring_expense"("uuid", "uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_recurring_expense"("uuid", "uuid", "uuid") TO "service_role";


-- ============================================================
-- 展開（每晚由 db-backup workflow 呼叫）
-- ============================================================
--
-- 冪等靠 create_expense 既有的 client_requests 機制：client_request_id 是
-- 'recur_<規則id>_<到期日>'，決定性字串。作業重跑、或同一晚跑兩次，第二次
-- 只會拿回既有的那筆支出，不會重複記帳。
--
-- 追補上限 12 期：伺服器停機幾天要補得回來，但一條 next_run_date 落在三年
-- 前的規則不該一次噴出 36 筆帳。超過就直接跳到現在，並記在 last_error。
--
-- 每條規則各自 begin/exception：一條規則的建立者離開群組，不該讓整晚的展開
-- 全部停擺。失敗的那條停用並留下原因。
CREATE OR REPLACE FUNCTION "public"."materialise_recurring_expenses"()
  RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_rule record;
  v_created int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_guard int;
  v_due date;
  v_share_count int;
  v_base int;
  v_remainder int;
  v_shares jsonb;
  v_payload jsonb;
begin
  for v_rule in
    select * from recurring_expenses
    where active = true and next_run_date <= current_date
    order by next_run_date
  loop
    v_guard := 0;
    v_due := v_rule.next_run_date;

    begin
      while v_due <= current_date and v_guard < 12 loop
        v_share_count := array_length(v_rule.share_member_ids, 1);
        -- 平均分攤，餘數配給前幾位——與前端 buildEqualShareAmountsMinor 同一
        -- 條規則，所以分攤金額加總永遠等於總額。
        v_base := v_rule.amount_minor / v_share_count;
        v_remainder := v_rule.amount_minor % v_share_count;

        select jsonb_agg(jsonb_build_object(
          'member_id', m.member_id,
          'share_type', 'equal',
          'amount_minor', v_base + case when m.idx <= v_remainder then 1 else 0 end
        ))
        into v_shares
        from (
          select unnest(v_rule.share_member_ids) as member_id,
                 generate_series(1, v_share_count) as idx
        ) m;

        v_payload := jsonb_build_object(
          'title', v_rule.title,
          'kind', 'expense',
          'category', v_rule.category,
          'amount_minor', v_rule.amount_minor,
          'currency', v_rule.currency,
          'expense_date', v_due,
          'note', v_rule.note,
          'client_request_id', 'recur_' || v_rule.id::text || '_' || v_due::text,
          'expense_payments', jsonb_build_array(jsonb_build_object(
            'payer_member_id', v_rule.payer_member_id,
            'amount_minor', v_rule.amount_minor,
            'currency', v_rule.currency
          )),
          'expense_shares', v_shares
        );

        perform create_expense(v_rule.group_id, v_rule.owner_user_id, v_payload);
        v_created := v_created + 1;
        v_due := (v_due + interval '1 month')::date;
        v_guard := v_guard + 1;
      end loop;

      if v_due <= current_date then
        -- 追補上限用完：跳到下一個未來的到期日，別讓它每晚都再補 12 筆。
        v_skipped := v_skipped + 1;
        while v_due <= current_date loop
          v_due := (v_due + interval '1 month')::date;
        end loop;
        update recurring_expenses set
          next_run_date = v_due,
          last_run_at = now(),
          last_error = '落後超過 12 期，已跳至下一次到期日；中間的帳請手動補。'
        where id = v_rule.id;
      else
        update recurring_expenses set
          next_run_date = v_due, last_run_at = now(), last_error = null
        where id = v_rule.id;
      end if;

    exception when others then
      v_failed := v_failed + 1;
      update recurring_expenses set active = false, last_error = SQLERRM, last_run_at = now()
      where id = v_rule.id;
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'failed', v_failed, 'skipped', v_skipped);
end;
$$;

ALTER FUNCTION "public"."materialise_recurring_expenses"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."materialise_recurring_expenses"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."materialise_recurring_expenses"() TO "service_role";
