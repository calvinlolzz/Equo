-- 留言的推播想說「某某在『晚餐』說：這筆我請」，而標題不在留言上。
--
-- 讓 create_expense_comment 順手帶回它，而不是讓路由為了一個字串再往資料庫跑一
-- 趟：判斷支出存不存在的那個查詢本來就要讀那一列。expense_title 只活到推播組完
-- 字串為止，路由會在回應送出前把它拿掉——它不是留言的一部分。
--
-- 重送時刻意不帶標題。那不是省事：路由正是用「有沒有標題」判斷這是不是第一次
-- 寫入，所以離線重送或連點兩下不會把同一句話推播兩次。
CREATE OR REPLACE FUNCTION "public"."create_expense_comment"("p_group_id" "uuid", "p_user_id" "uuid", "p_expense_id" "uuid", "p_body" "text", "p_client_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_member_id uuid;
  v_existing_id uuid;
  v_comment_id uuid;
  v_title text;
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
    -- 重送不帶標題：這一則早就送過推播了，再送一次只是同一句話出現兩次。
    return public.expense_comment_json(v_existing_id);
  end if;

  -- 支出必須還活著、而且屬於這個群組。少了 group_id 這半邊，知道任何一個
  -- expense id 的成員就能在別人的群組裡留言。
  select e.title into v_title
  from expenses e
  where e.id = p_expense_id
    and e.group_id = p_group_id
    and e.deleted_at is null;

  if not found then
    raise exception 'EXPENSE_NOT_FOUND';
  end if;

  insert into expense_comments (expense_id, group_id, member_id, body)
  values (p_expense_id, p_group_id, v_member_id, left(v_body, 500))
  returning id into v_comment_id;

  insert into client_requests (group_id, client_request_id, resource_id)
  values (p_group_id, p_client_request_id, v_comment_id)
  on conflict (group_id, client_request_id) do nothing;

  return public.expense_comment_json(v_comment_id)
    || jsonb_build_object('expense_title', coalesce(v_title, ''));
end;
$$;
