-- 站台公告與維護模式。
--
-- 兩件事放同一列設定，因為它們幾乎總是一起用：要維護就先掛公告，維護完兩個一起
-- 收掉。分成兩列只會多一次寫入與一種「公告收了但維護還開著」的狀態。
--
-- 公告有 ends_at 而維護沒有。這個不對稱是刻意的：**沒有人會記得把公告拿下來**，
-- 一則過期三週的「本週六維護」比沒有公告更糟；而關掉維護模式是計畫中的最後一步，
-- 讓它自己到期反而危險——時間到了、事情還沒做完，網站就自己開門了。

INSERT INTO "public"."app_settings" ("key", "value")
VALUES ('site_notice', jsonb_build_object(
  'banner', jsonb_build_object('message', '', 'level', 'info', 'ends_at', NULL),
  'maintenance', jsonb_build_object('enabled', false, 'message', '')
))
ON CONFLICT ("key") DO NOTHING;


-- ============================================================
-- 讀：公開端點與後台共用同一支
-- ============================================================
--
-- 一律回完整形狀（缺鍵補預設），呼叫端才不用各自處理「設定列還不存在」與「某個鍵
-- 是舊版寫的」。ends_at 過了就當作沒有公告——在這裡判斷而不是交給客戶端，因為每
-- 一台客戶端的時鐘都可能是錯的，而伺服器只有一個。
CREATE OR REPLACE FUNCTION "public"."site_notice_settings"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with parts as (
    select
      coalesce((select value -> 'banner' from app_settings where key = 'site_notice'), '{}'::jsonb) as banner,
      coalesce((select value -> 'maintenance' from app_settings where key = 'site_notice'), '{}'::jsonb) as maintenance
  )
  select jsonb_build_object(
    'banner', jsonb_build_object(
      'message', coalesce(parts.banner ->> 'message', ''),
      'level', coalesce(nullif(parts.banner ->> 'level', ''), 'info'),
      'ends_at', parts.banner -> 'ends_at',
      -- 「現在該不該顯示」由伺服器決定，客戶端只照做。
      'active', nullif(btrim(coalesce(parts.banner ->> 'message', '')), '') is not null
                and (
                  parts.banner ->> 'ends_at' is null
                  or (parts.banner ->> 'ends_at')::timestamptz > now()
                )
    ),
    'maintenance', jsonb_build_object(
      'enabled', coalesce((parts.maintenance ->> 'enabled')::boolean, false),
      'message', coalesce(parts.maintenance ->> 'message', '')
    )
  )
  from parts;
$$;

ALTER FUNCTION "public"."site_notice_settings"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."site_notice_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."site_notice_settings"() TO "service_role";


-- ============================================================
-- 寫：後台
-- ============================================================
--
-- 跟其他 admin_console_set_* 一樣自己寫稽核記錄。維護模式是這個後台裡少數會影響到
-- 「所有人現在能不能記帳」的開關，事後一定要查得到是誰在什麼時候開的。
CREATE OR REPLACE FUNCTION "public"."admin_console_set_site_notice"("p_actor" "uuid", "p_actor_email" "text", "p_banner_message" "text", "p_banner_level" "text", "p_banner_ends_at" timestamp with time zone, "p_maintenance_enabled" boolean, "p_maintenance_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_level text := lower(btrim(coalesce(p_banner_level, 'info')));
  v_banner text := btrim(coalesce(p_banner_message, ''));
  v_maint_message text := btrim(coalesce(p_maintenance_message, ''));
  v_enabled boolean := coalesce(p_maintenance_enabled, false);
begin
  if v_level not in ('info', 'warning') then
    raise exception 'INVALID_LEVEL';
  end if;

  -- 500 字是給一句公告的，不是給一篇公告的。橫幅擠不下更多。
  if char_length(v_banner) > 500 or char_length(v_maint_message) > 500 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;

  insert into app_settings (key, value, updated_at)
  values ('site_notice', jsonb_build_object(
    'banner', jsonb_build_object(
      'message', v_banner,
      'level', v_level,
      'ends_at', to_jsonb(p_banner_ends_at)
    ),
    'maintenance', jsonb_build_object(
      'enabled', v_enabled,
      'message', v_maint_message
    )
  ), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'site_notice.set',
    jsonb_build_object(
      'maintenance_enabled', v_enabled,
      'banner_level', v_level,
      -- 內容也記下來：事後要重建「當時大家看到的是什麼」，而設定列只留最新一版。
      'banner_message', v_banner,
      'maintenance_message', v_maint_message,
      'banner_ends_at', to_jsonb(p_banner_ends_at)
    )
  );

  return public.site_notice_settings();
end;
$$;

ALTER FUNCTION "public"."admin_console_set_site_notice"("uuid", "text", "text", "text", timestamp with time zone, boolean, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_set_site_notice"("uuid", "text", "text", "text", timestamp with time zone, boolean, "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_site_notice"("uuid", "text", "text", "text", timestamp with time zone, boolean, "text") TO "service_role";
