-- 推播要用收件者看得懂的語言寫。
--
-- 語言存在 **訂閱** 上而不是使用者上，因為一筆訂閱就是一台裝置：同一個人的公司
-- 筆電是英文、手機是中文，兩邊都該收到自己讀得懂的那一則。順帶一個好處是不用另
-- 外同步設定——訂閱本來就會在語言改變後重新送上來。
--
-- NULL 代表「這台裝置沒說」，由伺服器退回預設語言。不設 DEFAULT 是刻意的：既有
-- 的訂閱不該被假裝成「選過中文」，它們只是還沒回報過。

ALTER TABLE "public"."push_subscriptions"
  ADD COLUMN IF NOT EXISTS "locale" "text";

ALTER TABLE "public"."push_subscriptions" DROP CONSTRAINT IF EXISTS "push_subscriptions_locale_known";

-- 允許清單而不是自由文字：這個值會挑一份字典，打錯字應該當場被擋下來，而不是變成
-- 某個人再也收不到看得懂的通知。加語言時要改這裡。
ALTER TABLE "public"."push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_locale_known"
  CHECK ("locale" IS NULL OR "locale" IN ('zh-Hant', 'en'));

COMMENT ON COLUMN "public"."push_subscriptions"."locale" IS
  '這台裝置要用哪種語言收推播。NULL = 沒回報過，伺服器用預設。';


-- 訂閱時把語言一起帶上來。
CREATE OR REPLACE FUNCTION "public"."upsert_push_subscription"("p_user" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text", "p_locale" "text" DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_endpoint text;
begin
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, locale)
  values (p_user, p_endpoint, p_p256dh, p_auth, nullif(p_user_agent, ''), nullif(p_locale, ''))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        -- 只在有帶語言時覆寫：舊版 bundle 不會送這個欄位，而它送出的訂閱更新不該
        -- 把使用者已經選好的語言清成 NULL。
        locale = coalesce(nullif(p_locale, ''), push_subscriptions.locale),
        updated_at = now()
  returning endpoint into v_endpoint;

  return jsonb_build_object('endpoint', v_endpoint);
end;
$$;

ALTER FUNCTION "public"."upsert_push_subscription"("uuid", "text", "text", "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."upsert_push_subscription"("uuid", "text", "text", "text", "text", "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_push_subscription"("uuid", "text", "text", "text", "text", "text") TO "service_role";


-- 三支 targets 函式都要把 locale 帶出來，寄件端才分得出該用哪一份字典。錨點貼補：
-- 三支的那一段是同一段文字，先確認每支裡唯一，貼補後再確認真的落地。
DO $patch$
declare
  v_anchor constant text :=
    E'        ''endpoint'', s.endpoint,
        ''p256dh'', s.p256dh,
        ''auth'', s.auth
';
  v_replacement constant text :=
    E'        ''endpoint'', s.endpoint,
        ''p256dh'', s.p256dh,
        ''auth'', s.auth,
        ''locale'', s.locale
';
  v_name text;
  v_def text;
  v_hits integer;
begin
  foreach v_name in array array['push_targets_for_group', 'push_targets_for_member', 'push_targets_for_admins'] loop
    v_def := pg_get_functiondef(('public.' || v_name)::regproc);

    v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    if v_hits <> 1 then
      raise exception 'anchor appears % times in % (expected 1)', v_hits, v_name;
    end if;

    execute replace(v_def, v_anchor, v_replacement);

    if position('''locale'', s.locale' in pg_get_functiondef(('public.' || v_name)::regproc)) = 0 then
      raise exception 'patch did not land in %', v_name;
    end if;
  end loop;
end
$patch$;
