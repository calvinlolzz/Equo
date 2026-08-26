-- 世代留存（cohort retention）。
--
-- ⚠️ 先講這個指標量不到什麼：**只有寫入有逐筆時間戳。**
--
-- 「活躍」＝那段期間內記了一筆帳或留了一則言。開 App 看自己欠多少不會留下任何可
-- 以回溯的痕跡——`group_members.last_read_at` 只存最後一次，沒有歷史，所以做不出
-- 曲線。對一個分帳 App 來說這是個真的盲點：那個從不記帳、但每次都準時付錢的人，
-- 在這張圖上完全不存在。看這張圖時要記得它說的是「還有沒有在記帳」，不是「還有
-- 沒有在用」。
--
-- 已刪除的支出照算。問題是「這個人那週有沒有在用」，記了又刪掉也是用過。

CREATE OR REPLACE FUNCTION "public"."admin_console_retention"("p_period" "text" DEFAULT 'week', "p_periods" integer DEFAULT 12) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_period text := lower(btrim(coalesce(p_period, 'week')));
  v_max integer := least(greatest(coalesce(p_periods, 12), 1), 52);
  v_result jsonb;
begin
  if v_period not in ('week', 'month') then
    raise exception 'INVALID_PERIOD';
  end if;

  with cohorts as (
    select u.id as user_id,
           date_trunc(v_period, u.created_at at time zone 'Asia/Taipei') as cohort
    from users u
  ),
  activity as (
    select gm.user_id,
           date_trunc(v_period, e.created_at at time zone 'Asia/Taipei') as active_period
    from expenses e
    join group_members gm on gm.id = e.created_by_member_id
    where gm.user_id is not null
    union
    select gm.user_id,
           date_trunc(v_period, c.created_at at time zone 'Asia/Taipei')
    from expense_comments c
    join group_members gm on gm.id = c.member_id
    where gm.user_id is not null
  ),
  sizes as (
    select cohort, count(*)::int as cohort_size
    from cohorts
    group by cohort
  ),
  -- 每個世代 × 每個位移都要有一格，包含 0 的那些：把沒有活動的期間整個省略，
  -- 會讓一個中間空掉的世代看起來像是資料到那裡就結束了。
  grid as (
    select s.cohort, s.cohort_size, g.offset_index
    from sizes s
    cross join generate_series(0, v_max - 1) as g(offset_index)
    where s.cohort + (g.offset_index * (('1 ' || v_period)::interval))
          <= date_trunc(v_period, now() at time zone 'Asia/Taipei')
  ),
  filled as (
    select
      grid.cohort,
      grid.cohort_size,
      grid.offset_index,
      (
        select count(distinct a.user_id)
        from activity a
        join cohorts c on c.user_id = a.user_id and c.cohort = grid.cohort
        where a.active_period = grid.cohort + (grid.offset_index * (('1 ' || v_period)::interval))
      )::int as retained
    from grid
  )
  select jsonb_build_object(
    'period', v_period,
    'total_users', (select count(*) from users),
    -- 這個數字在樣本小的時候比整條曲線有用：註冊了但從來沒記過任何一筆的人。
    'never_active', (
      select count(*) from users u
      where not exists (select 1 from activity a where a.user_id = u.id)
    ),
    'cohorts', coalesce((
      select jsonb_agg(cohort_row order by cohort_row ->> 'start')
      from (
        select jsonb_build_object(
          'start', f.cohort::date,
          'size', f.cohort_size,
          'retained', jsonb_agg(f.retained order by f.offset_index)
        ) as cohort_row
        from filled f
        group by f.cohort, f.cohort_size
      ) rows
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

ALTER FUNCTION "public"."admin_console_retention"("text", integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_retention"("text", integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_retention"("text", integer) TO "service_role";
