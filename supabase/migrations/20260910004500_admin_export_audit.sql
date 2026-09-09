-- 批次 CSV 匯出的稽核。
--
-- 這是稽核模型裡一個講不通的洞：一個使用者的「匯出個資」記 user.export，
-- 而把五千筆使用者的 email、名字、群組數、最後活躍時間拉成 CSV 帶走，
-- 因為那只是後台在前端跑三個 GET 迴圈，所以什麼都沒留下。同一種資料，
-- 量更大，反而沒有記錄。
--
-- 記的是「誰、什麼時候、匯出了哪一張表的幾列、當時的搜尋條件是什麼」。
-- 不記內容——那是整份資料的副本，稽核表不是拿來存這個的；要重建匯出的
-- 範圍，搜尋條件加上時間就夠了。
--
-- 由前端在下載成功之後回報。這代表「下載了但沒回報」理論上是可能的
-- （分頁在最後一刻被關掉），所以它是一份**盡責的**記錄而不是一份保證。
-- 真正的保證要把匯出整個搬到伺服器端產生，那是另一件事；在那之前，
-- 有記錄遠比沒有好，而且列出來的每一筆都是真的。
CREATE OR REPLACE FUNCTION "public"."admin_console_log_export"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_kind" "text",
  "p_rows" integer,
  "p_total" integer,
  "p_search" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text;
begin
  -- 白名單，不是為了防注入（參數化查詢本來就防住了），是為了讓稽核表裡的
  -- kind 永遠是那三個值之一，篩選才有意義。
  if p_kind not in ('users', 'groups', 'expenses') then
    raise exception 'INVALID_EXPORT_KIND';
  end if;

  v_kind := p_kind;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'admin.export',
    jsonb_build_object(
      'kind', v_kind,
      'rows', greatest(coalesce(p_rows, 0), 0),
      'total', greatest(coalesce(p_total, 0), 0),
      -- 有沒有被 5,000 列的上限砍到。存下來，因為「匯出了 5,000 列」跟
      -- 「符合的就是 5,000 列」是兩件事。
      'truncated', coalesce(p_total, 0) > coalesce(p_rows, 0),
      -- 空字串存成 null：稽核表裡 '' 跟「沒有條件」看起來一樣，但問的人
      -- 想知道的是後者。
      'search', nullif(btrim(coalesce(p_search, '')), '')
    )
  );

  return jsonb_build_object('logged', true);
end;
$$;

ALTER FUNCTION "public"."admin_console_log_export"("uuid", "text", "text", integer, integer, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_log_export"("uuid", "text", "text", integer, integer, "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_log_export"("uuid", "text", "text", integer, integer, "text") TO "service_role";
