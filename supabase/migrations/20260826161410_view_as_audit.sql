-- 「以某位使用者的身分檢視」的稽核。
--
-- 這是後台裡最需要留下記錄的動作之一：它本身不給新的資料權限（管理員本來就能查
-- 那個人的群組與帳目，甚至匯出），但它是唯一一個「用別人的眼睛看」的入口，事後
-- 必須答得出來是誰、在什麼時候、看了誰。
--
-- 只記開始，不記結束。結束可能是按了離開、可能是關掉分頁、可能是 15 分鐘到期，
-- 前兩者記不到，而一份只有一半可信的記錄比沒有更糟——真正的界線是那個 token 的
-- 有效期，它寫在 metadata 裡。
CREATE OR REPLACE FUNCTION "public"."admin_console_log_view_as"("p_actor" "uuid", "p_actor_email" "text", "p_target" "uuid", "p_expires_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_target_email text;
begin
  select email into v_target_email from users where id = p_target;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'user.view_as',
    jsonb_build_object(
      'target_user_id', p_target,
      -- 記下當時的信箱：使用者刪帳號後 users 那一列會消失，只留 uuid 的記錄等於
      -- 沒有記錄。
      'target_email', v_target_email,
      'expires_at', to_jsonb(p_expires_at)
    )
  );

  return jsonb_build_object('target_user_id', p_target, 'target_email', v_target_email);
end;
$$;

ALTER FUNCTION "public"."admin_console_log_view_as"("uuid", "text", "uuid", timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_log_view_as"("uuid", "text", "uuid", timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_log_view_as"("uuid", "text", "uuid", timestamp with time zone) TO "service_role";
