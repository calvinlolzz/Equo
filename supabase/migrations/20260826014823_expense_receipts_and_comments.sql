-- 一筆支出可以有多張收據，而且可以被討論。
--
-- 兩件事撞上同一個限制：**編輯一筆支出會換一個新的 expense id**——replace_expense
-- 是「把舊的軟刪除，再建一筆新的」。任何掛在 expense_id 上的東西，編輯時都必須跟
-- 著搬，否則改一個錯字就會讓收據或留言安靜地消失。兩者的解法不同：
--   * 收據走 payload：客戶端編輯時把整份清單帶回來，create_expense 照單寫入。
--   * 留言留在資料庫：客戶端不知道有哪些留言，所以由 replace_expense 改指向新 id。


-- ============================================================
-- 1. 多張收據
-- ============================================================

ALTER TABLE "public"."expenses"
  ADD COLUMN IF NOT EXISTS "image_urls" "text"[] NOT NULL DEFAULT '{}';

-- image_url 從此是衍生欄位（= image_urls[1]），唯一的寫入者是 create_expense。
-- 留著它不是為了相容而已：列表縮圖、搜尋結果、後台全都只需要一張，讓它們去讀
-- 一個陣列的第一個元素只是把同一個決定散到四個地方。
UPDATE "public"."expenses"
SET "image_urls" = ARRAY["image_url"]
WHERE "image_url" IS NOT NULL
  AND "image_urls" = '{}';

ALTER TABLE "public"."expenses" DROP CONSTRAINT IF EXISTS "expenses_image_urls_bounded";

-- 五張是刻意的上限。收據是拿來證明一筆消費的，不是相簿；而每一張都會被寫進
-- 儲存空間，那是免費方案裡會先撞到的那道牆（見 docs/OPERATIONS.md）。
ALTER TABLE "public"."expenses"
  ADD CONSTRAINT "expenses_image_urls_bounded"
  CHECK (
    COALESCE("array_length"("image_urls", 1), 0) <= 5
    AND "array_position"("image_urls", NULL) IS NULL
  );

COMMENT ON COLUMN "public"."expenses"."image_urls" IS
  '收據照片，依顯示順序。image_url 是衍生欄位（第一張），別分開寫。';


-- ============================================================
-- 2. 留言
-- ============================================================

CREATE TABLE IF NOT EXISTS "public"."expense_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_id" "uuid" NOT NULL,
    -- 反正規化：權限判斷、清理、後台查詢都以群組為單位，沒有它每一次都要多
    -- join 一次 expenses 才能知道這則留言屬於誰。
    "group_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "expense_comments_body_bounded" CHECK (("char_length"("body") >= 1) AND ("char_length"("body") <= 500))
);

ALTER TABLE ONLY "public"."expense_comments"
  ADD CONSTRAINT "expense_comments_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."expense_comments"
  ADD CONSTRAINT "expense_comments_expense_id_fkey"
  FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."expense_comments"
  ADD CONSTRAINT "expense_comments_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

-- 沒有 ON DELETE：group_members 不會被刪，帳號刪除是脫鉤匿名化（見
-- docs/OPERATIONS.md 與 delete_my_account）。這裡跟 expense_shares 同一個姿態。
ALTER TABLE ONLY "public"."expense_comments"
  ADD CONSTRAINT "expense_comments_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id");

-- 讀取永遠是「某一筆支出的留言，依時間」。部分索引，因為已刪的留言不會被讀。
CREATE INDEX IF NOT EXISTS "expense_comments_expense_idx"
  ON "public"."expense_comments" USING "btree" ("expense_id", "created_at")
  WHERE ("deleted_at" IS NULL);

-- 外鍵索引：不是為了查詢，是為了刪父列時不要整表掃描。
CREATE INDEX IF NOT EXISTS "expense_comments_member_idx"
  ON "public"."expense_comments" USING "btree" ("member_id");
CREATE INDEX IF NOT EXISTS "expense_comments_group_idx"
  ON "public"."expense_comments" USING "btree" ("group_id");

-- 跟其他資料表同一個姿態：service_role 專用，RLS 開著但沒有 policy，所以就算
-- 哪天有人不小心 grant 給 anon/authenticated，還是一律拒絕。
ALTER TABLE "public"."expense_comments" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."expense_comments" TO "service_role";


-- ============================================================
-- 3. create_expense：收下整份收據清單
-- ============================================================
--
-- 完整重述（取自 pg_get_functiondef 的線上定義，不是靠記憶重建），因為改動落在
-- 三個分散的位置：宣告、清單推導、INSERT。差異只有那三處。
--
-- **payload 有沒有 image_urls 這個鍵，跟它是不是空陣列，是兩件事。** 有鍵＝這份
-- payload 說了收據有哪些（空陣列＝一張都沒有，使用者刪光了）；沒有鍵＝這份
-- payload 沒有在講收據，退回舊的單張欄位。少了這個區分，離線佇列裡凍結的舊
-- payload 與快取住的舊 bundle 會在重送時把收據清成空的。

CREATE OR REPLACE FUNCTION "public"."create_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
  v_client_request_id text := p_payload ->> 'client_request_id';
  v_existing_id uuid;
  v_expense_id uuid;
  v_invalid_member_id uuid;
  v_image_urls text[];
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = v_client_request_id;

  if v_existing_id is not null then
    return public.expense_json(v_existing_id);
  end if;

  select referenced.member_id into v_invalid_member_id
  from (
    select (payment ->> 'payer_member_id')::uuid as member_id
    from jsonb_array_elements(coalesce(p_payload -> 'expense_payments', '[]'::jsonb)) as payment
    union all
    select (share ->> 'member_id')::uuid
    from jsonb_array_elements(coalesce(p_payload -> 'expense_shares', '[]'::jsonb)) as share
    union all
    select nullif(p_payload ->> 'transfer_to_member_id', '')::uuid
  ) as referenced
  where referenced.member_id is not null
    and not exists (
      select 1
      from group_members gm
      where gm.id = referenced.member_id
        and gm.group_id = p_group_id
        and gm.status = 'active'
    )
  limit 1;

  if v_invalid_member_id is not null then
    raise exception 'INVALID_MEMBER:%', v_invalid_member_id;
  end if;

  -- 收據清單：有 image_urls 鍵就照它，沒有才退回單張的 image_url。
  if p_payload ? 'image_urls' then
    select coalesce(array_agg(url order by ord), '{}'::text[])
    into v_image_urls
    from jsonb_array_elements_text(p_payload -> 'image_urls') with ordinality as listed(url, ord)
    where nullif(listed.url, '') is not null;
  else
    v_image_urls := case
      when nullif(p_payload ->> 'image_url', '') is null then '{}'::text[]
      else array[p_payload ->> 'image_url']
    end;
  end if;

  -- CHECK 也擋得住，但那會是一個 23514，前端只能翻成「未知錯誤」。
  if coalesce(array_length(v_image_urls, 1), 0) > 5 then
    raise exception 'TOO_MANY_IMAGES';
  end if;

  insert into expenses (
    group_id,
    created_by_member_id,
    title,
    kind,
    category,
    amount_minor,
    currency,
    expense_date,
    note,
    transfer_to_member_id,
    client_request_id,
    image_url,
    image_urls
  )
  values (
    p_group_id,
    v_member_id,
    p_payload ->> 'title',
    p_payload ->> 'kind',
    coalesce(nullif(p_payload ->> 'category', ''), 'other'),
    (p_payload ->> 'amount_minor')::integer,
    coalesce(nullif(p_payload ->> 'currency', ''), 'TWD'),
    coalesce((nullif(p_payload ->> 'expense_date', ''))::date, current_date),
    nullif(p_payload ->> 'note', ''),
    (nullif(p_payload ->> 'transfer_to_member_id', ''))::uuid,
    v_client_request_id,
    v_image_urls[1],
    v_image_urls
  )
  returning id into v_expense_id;

  insert into expense_payments (expense_id, payer_member_id, amount_minor, currency)
  select
    v_expense_id,
    (payment ->> 'payer_member_id')::uuid,
    (payment ->> 'amount_minor')::integer,
    coalesce(nullif(payment ->> 'currency', ''), 'TWD')
  from jsonb_array_elements(coalesce(p_payload -> 'expense_payments', '[]'::jsonb)) as payment;

  insert into expense_shares (expense_id, member_id, share_type, share_value, amount_minor)
  select
    v_expense_id,
    (share ->> 'member_id')::uuid,
    share ->> 'share_type',
    (nullif(share ->> 'share_value', ''))::numeric,
    (share ->> 'amount_minor')::integer
  from jsonb_array_elements(coalesce(p_payload -> 'expense_shares', '[]'::jsonb)) as share;

  insert into client_requests (group_id, client_request_id, resource_id)
  values (p_group_id, v_client_request_id, v_expense_id)
  on conflict (group_id, client_request_id) do nothing;

  return public.expense_json(v_expense_id);
end;
$$;


-- ============================================================
-- 4. 三個讀取路徑都要帶上收據清單
-- ============================================================
--
-- expense_json（寫入後的回應、刪除的回應）、get_group_detail（列表）、
-- search_expenses（搜尋）。**三個都要**：客戶端編輯時把清單原樣送回，任何一條
-- 路徑漏掉 image_urls，從那條路徑打開的編輯就會把第二張以後的收據刪掉。

CREATE OR REPLACE FUNCTION "public"."expense_json"("p_expense_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'id', e.id,
    'group_id', e.group_id,
    'title', e.title,
    'kind', e.kind,
    'category', e.category,
    'amount_minor', e.amount_minor,
    'currency', e.currency,
    'expense_date', e.expense_date,
    'note', e.note,
    'transfer_to_member_id', e.transfer_to_member_id,
    'created_at', e.created_at,
    'version', e.version,
    'client_request_id', e.client_request_id,
    'image_url', e.image_url,
    'image_urls', to_jsonb(e.image_urls)
  )
  from expenses e
  where e.id = p_expense_id;
$$;


-- get_group_detail 與 search_expenses 是一百多行的函式，而改動是同一行。用錨點
-- 貼補而不是整段重述：先確認錨點在該函式裡唯一，貼補後再確認真的多了那一段。
DO $patch$
declare
  v_anchor constant text :=
    '''version'', e.version, ''client_request_id'', e.client_request_id, ''image_url'', e.image_url,';
  v_replacement constant text :=
    '''version'', e.version, ''client_request_id'', e.client_request_id, ''image_url'', e.image_url,'
    || E'\n            ''image_urls'', to_jsonb(e.image_urls),';
  v_name text;
  v_def text;
  v_hits integer;
begin
  foreach v_name in array array['get_group_detail', 'search_expenses'] loop
    v_def := pg_get_functiondef(('public.' || v_name)::regproc);

    v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    if v_hits <> 1 then
      raise exception 'anchor appears % times in % (expected 1)', v_hits, v_name;
    end if;

    execute replace(v_def, v_anchor, v_replacement);

    v_def := pg_get_functiondef(('public.' || v_name)::regproc);
    if position('''image_urls'', to_jsonb(e.image_urls)' in v_def) = 0 then
      raise exception 'patch did not land in %', v_name;
    end if;
  end loop;
end
$patch$;


-- ============================================================
-- 5. replace_expense：把留言搬到新的那筆上
-- ============================================================
--
-- 編輯是「軟刪除舊的、建一筆新的」，所以留言掛的 expense_id 會指向一筆已經看不
-- 見的支出。收據不需要這個處理，因為它們隨 payload 一起被重新寫入；留言不在
-- payload 裡，只有伺服器知道有哪些。

CREATE OR REPLACE FUNCTION "public"."replace_expense"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
  v_existing_id uuid;
  v_previous jsonb;
  v_deleted_id uuid;
  v_next jsonb;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = p_payload ->> 'client_request_id';

  if v_existing_id is not null then
    return jsonb_build_object('expense', public.expense_json(v_existing_id), 'previous', null);
  end if;

  v_previous := public.expense_json(p_expense_id);

  update expenses
  set deleted_at = now(),
      version = version + 1,
      updated_at = now()
  where group_id = p_group_id
    and id = p_expense_id
    and deleted_at is null
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  v_next := public.create_expense(p_group_id, p_user_id, p_payload);

  -- 改一個錯字不該讓整串討論消失。
  update expense_comments
  set expense_id = (v_next ->> 'id')::uuid
  where expense_id = p_expense_id;

  return jsonb_build_object('expense', v_next, 'previous', v_previous);
end;
$$;


-- ============================================================
-- 6. 留言的三個 RPC
-- ============================================================
--
-- 回傳裡只有 member_id，沒有名字也沒有頭像。客戶端本來就握著這個群組的成員清
-- 單，讓它自己對照的好處是改名或換頭像立刻反映在整串舊留言上——把名字寫死在留
-- 言裡，等於在每一則留言上凍結一份當下的個人資料。

CREATE OR REPLACE FUNCTION "public"."expense_comment_json"("p_comment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'id', c.id,
    'expense_id', c.expense_id,
    'member_id', c.member_id,
    'body', c.body,
    'created_at', c.created_at
  )
  from expense_comments c
  where c.id = p_comment_id;
$$;

ALTER FUNCTION "public"."expense_comment_json"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."expense_comment_json"("uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expense_comment_json"("uuid") TO "service_role";


CREATE OR REPLACE FUNCTION "public"."list_expense_comments"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'expense_id', c.expense_id,
          'member_id', c.member_id,
          'body', c.body,
          'created_at', c.created_at
        )
        order by c.created_at, c.id
      )
      from expense_comments c
      where c.expense_id = p_expense_id
        and c.group_id = p_group_id
        and c.deleted_at is null
    ),
    '[]'::jsonb
  );
end;
$$;

ALTER FUNCTION "public"."list_expense_comments"("uuid", "uuid", "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_expense_comments"("uuid", "uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_expense_comments"("uuid", "uuid", "uuid") TO "service_role";


CREATE OR REPLACE FUNCTION "public"."create_expense_comment"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_body" "text", "p_client_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
  v_existing_id uuid;
  v_comment_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  if v_body = '' then
    raise exception 'EMPTY_COMMENT';
  end if;

  -- 跟支出共用同一張冪等鍵表。斷線重送、雙擊送出，回到的都是原本那一則。
  select cr.resource_id into v_existing_id
  from client_requests cr
  where cr.group_id = p_group_id
    and cr.client_request_id = p_client_request_id;

  if v_existing_id is not null then
    return public.expense_comment_json(v_existing_id);
  end if;

  -- 支出必須還活著、而且屬於這個群組。少了 group_id 這半邊，知道任何一個
  -- expense id 的成員就能在別人的群組裡留言。
  if not exists (
    select 1
    from expenses e
    where e.id = p_expense_id
      and e.group_id = p_group_id
      and e.deleted_at is null
  ) then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  insert into expense_comments (expense_id, group_id, member_id, body)
  values (p_expense_id, p_group_id, v_member_id, left(v_body, 500))
  returning id into v_comment_id;

  insert into client_requests (group_id, client_request_id, resource_id)
  values (p_group_id, p_client_request_id, v_comment_id)
  on conflict (group_id, client_request_id) do nothing;

  return public.expense_comment_json(v_comment_id);
end;
$$;

ALTER FUNCTION "public"."create_expense_comment"("uuid", "uuid", "uuid", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."create_expense_comment"("uuid", "uuid", "uuid", "text", "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_expense_comment"("uuid", "uuid", "uuid", "text", "text") TO "service_role";


-- 軟刪除，不是真的刪。自己的留言自己可以收回；群主也可以，因為群組裡唯一能處
-- 理「有人留了不該留的東西」的人就是他。
CREATE OR REPLACE FUNCTION "public"."delete_expense_comment"("p_group_id" "uuid", "p_user_id" "uuid", "p_comment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
  v_is_owner boolean;
  v_deleted_id uuid;
begin
  select gm.id into v_member_id
  from group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'NOT_A_GROUP_MEMBER';
  end if;

  select g.owner_member_id = v_member_id into v_is_owner
  from groups g
  where g.id = p_group_id;

  update expense_comments c
  set deleted_at = now()
  where c.id = p_comment_id
    and c.group_id = p_group_id
    and c.deleted_at is null
    and (c.member_id = v_member_id or coalesce(v_is_owner, false))
  returning c.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'COMMENT_NOT_FOUND';
  end if;

  return jsonb_build_object('id', v_deleted_id);
end;
$$;

ALTER FUNCTION "public"."delete_expense_comment"("uuid", "uuid", "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."delete_expense_comment"("uuid", "uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_expense_comment"("uuid", "uuid", "uuid") TO "service_role";


-- ============================================================
-- 7. 刪帳號時一併刪掉這個人寫過的留言
-- ============================================================
--
-- 帳目會留下來（改成掛在一個匿名的成員上），因為那些錢是大家共同的，抽掉一筆會
-- 動到別人的餘額。留言不是——那是他自己說的話，沒有留下來的理由。
--
-- 錨點貼補而不是重述：這支函式的 migration 檔早就跟線上定義漂移了，唯一可信的
-- 來源是 pg_get_functiondef。獨立群組裡的留言不需要處理，那邊 delete from
-- expenses 就會連帶刪掉。
DO $patch$
declare
  v_anchor constant text := '  update expenses set payer_id = null where payer_id = p_user;';
  v_addition constant text :=
    E'  -- 這個人寫過的留言。帳目留下來是因為錢是共同的；留言是他自己說的話。\n'
    || E'  delete from expense_comments\n'
    || E'   where member_id in (select id from group_members where user_id = p_user);\n'
    || E'\n';
  v_def text := pg_get_functiondef('public.delete_my_account'::regproc);
  v_hits integer;
begin
  if position('delete from expense_comments' in v_def) > 0 then
    return; -- 已經套用過
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'delete_my_account anchor appears % times (expected 1)', v_hits;
  end if;

  execute replace(v_def, v_anchor, v_addition || v_anchor);

  v_def := pg_get_functiondef('public.delete_my_account'::regproc);
  if position('delete from expense_comments' in v_def) = 0 then
    raise exception 'delete_my_account patch did not land';
  end if;
  if position('last_admin_owner' in v_def) = 0 then
    raise exception 'delete_my_account lost its last-owner guard';
  end if;
end
$patch$;


-- ============================================================
-- 8. 保留規則：收回的留言不用留一輩子
-- ============================================================
--
-- 跟其他 purge_* 一樣有 30 天的地板：把天數設成 0 應該是「照預設」，不該是
-- 「現在就全清掉」。
CREATE OR REPLACE FUNCTION "public"."purge_deleted_expense_comments"("p_days" integer DEFAULT 90) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_days integer := greatest(coalesce(p_days, 90), 30);
  v_deleted integer;
begin
  delete from expense_comments
  where deleted_at is not null
    and deleted_at < now() - make_interval(days => v_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

ALTER FUNCTION "public"."purge_deleted_expense_comments"(integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."purge_deleted_expense_comments"(integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_deleted_expense_comments"(integer) TO "service_role";
