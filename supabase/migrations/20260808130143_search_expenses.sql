-- 記錄頁的搜尋，下推到資料庫。
--
-- 在此之前 filterExpenses() 只過濾「前端已載入的那一頁」（預設最新 100
-- 筆）。篩選器有全文、成員、分類、種類、起訖日六個欄位，看起來是搜整個
-- 群組，實際上搜不到窗口以外的任何一筆；空結果時面板雖然仍保留「載入更
-- 多」，但字面寫的是斷定句「沒有符合的紀錄」，而且要翻到去年的帳得反覆
-- 按那顆按鈕。
--
-- 這支函式回傳「整段歷史」的比對結果：一頁資料 + 全體比對筆數與金額，
-- 所以摘要列講的是真話而不是這一頁的話。
--
-- ⚠️ 語意必須與 apps/web/src/app/expenseFilter.ts 的 filterExpenses 完全
-- 一致，否則同一組條件在前端與伺服器會給出不同答案。逐條對應寫在下面。
CREATE OR REPLACE FUNCTION "public"."search_expenses"(
  "p_group_id" "uuid",
  "p_user_id" "uuid",
  "p_query" "text" DEFAULT '',
  "p_member_id" "uuid" DEFAULT NULL,
  "p_category" "text" DEFAULT NULL,
  "p_kind" "text" DEFAULT NULL,
  "p_from" "date" DEFAULT NULL,
  "p_to" "date" DEFAULT NULL,
  "p_limit" integer DEFAULT 50,
  "p_before_date" "date" DEFAULT NULL,
  "p_before_created_at" timestamp with time zone DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  -- ILIKE treats % and _ as wildcards; textMatches() uses String.includes(),
  -- which does not. Escape them (backslash first) so searching "50%" means
  -- the characters "50%" on both sides.
  v_text text := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');
  -- amountMatches(): strip , and whitespace, then only treat it as a number
  -- when what is left is all digits (with an optional decimal part).
  v_digits text := regexp_replace(v_query, '[,[:space:]]', '', 'g');
  v_numeric boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  if not exists (
    select 1 from group_members m
    where m.group_id = p_group_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    return null;
  end if;

  v_numeric := v_query <> '' and v_digits ~ '^\d+(\.\d+)?$';

  with matched as (
    select e.*
    from expenses e
    where e.group_id = p_group_id
      and e.deleted_at is null
      -- query: title/note substring, or an amount prefix. Mirrors
      -- textMatches() OR amountMatches().
      and (
        v_query = ''
        or e.title ilike '%' || v_text || '%'
        or coalesce(e.note, '') ilike '%' || v_text || '%'
        or (
          v_numeric
          and (
            -- major.toString() drops the trailing zeros formatAmount adds, so
            -- "1200" finds an expense stored as 120000 minor units.
            trim_scale(e.amount_minor::numeric / 100)::text like v_digits || '%'
            or e.amount_minor::text like v_digits || '%'
          )
        )
      )
      -- kind: absent means 'expense', matching (expense.kind ?? "expense").
      and (p_kind is null or coalesce(e.kind, 'expense') = p_kind)
      -- category: exact match, no 'general' folding (filterExpenses compares raw).
      and (p_category is null or e.category = p_category)
      -- memberId: everyone() = the payers, the share holders, and a transfer's
      -- recipient.
      and (
        p_member_id is null
        or exists (select 1 from expense_payments p where p.expense_id = e.id and p.payer_member_id = p_member_id)
        or exists (select 1 from expense_shares s where s.expense_id = e.id and s.member_id = p_member_id)
        or e.transfer_to_member_id = p_member_id
      )
      -- expenseDayKey(): expense_date is NOT NULL here, so the createdAt
      -- fallback only ever applies to client-built rows that have not
      -- round-tripped yet - there is nothing to fall back to server-side.
      and (p_from is null or e.expense_date >= p_from)
      and (p_to is null or e.expense_date <= p_to)
  ),
  page as (
    select m.*
    from matched m
    where p_before_date is null
       or p_before_created_at is null
       or (m.expense_date, m.created_at) < (p_before_date, p_before_created_at)
    order by m.expense_date desc, m.created_at desc
    limit v_limit + 1
  ),
  page_rows as (
    select p.* from page p order by p.expense_date desc, p.created_at desc limit v_limit
  )
  select jsonb_build_object(
    'expenses', (
      select coalesce(jsonb_agg(row_json.data order by row_json.expense_date desc, row_json.created_at desc), '[]'::jsonb)
      from (
        select e.expense_date, e.created_at, jsonb_build_object(
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
        from page_rows e
      ) row_json
    ),
    -- Over every match, not just this page - that is the whole point.
    'match_count', (select count(*) from matched),
    -- summariseFilteredExpenses(): settlements move money between members
    -- rather than out of the group, so only kind='expense' is summed.
    'match_total_minor', (
      select coalesce(sum(m.amount_minor), 0)::bigint
      from matched m where coalesce(m.kind, 'expense') = 'expense'
    ),
    'has_more', (select count(*) from page) > v_limit
  )
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."search_expenses"("uuid", "uuid", "text", "uuid", "text", "text", "date", "date", integer, "date", timestamp with time zone) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."search_expenses"("uuid", "uuid", "text", "uuid", "text", "text", "date", "date", integer, "date", timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_expenses"("uuid", "uuid", "text", "uuid", "text", "text", "date", "date", integer, "date", timestamp with time zone) TO "service_role";
