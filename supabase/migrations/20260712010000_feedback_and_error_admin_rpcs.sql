-- Feedback + error-reporting: admin console read RPCs over the (previously
-- dormant) app_feedback and app_error_logs tables, plus an audited feedback
-- status setter. User-facing writes go through the API runtime's service-role
-- REST inserts, not these functions. Security model as always: SECURITY
-- DEFINER, EXECUTE for service_role only.
--
-- Vocabulary comes from the tables' existing check constraints:
--   app_feedback.type   in ('problem','suggestion','confusing','other')
--   app_feedback.status in ('new','reviewing','done')
--   app_error_logs.source in ('web','admin')

create or replace function public.admin_console_feedback(
  p_limit integer,
  p_offset integer,
  p_status text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select f.*, u.email as user_email
    from app_feedback f
    left join users u on u.id = f.user_id
    where coalesce(nullif(p_status, ''), 'all') = 'all' or f.status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'feedback', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, user_email, type, message, contact, page, status, created_at
        from filtered
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

create or replace function public.admin_console_set_feedback_status(
  p_actor uuid,
  p_actor_email text,
  p_feedback_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row app_feedback%rowtype;
begin
  if p_status not in ('new', 'reviewing', 'done') then
    raise exception 'invalid feedback status: %', p_status;
  end if;

  update app_feedback
  set status = p_status
  where id = p_feedback_id
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'feedback.status',
    jsonb_build_object('feedback_id', v_row.id, 'status', p_status)
  );

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end
$$;

create or replace function public.admin_console_errors(
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from app_error_logs),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select e.id, u.email as user_email, e.source, e.message, e.context, e.page, e.created_at
        from app_error_logs e
        left join users u on u.id = e.user_id
        order by e.created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_console_feedback(integer, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_console_set_feedback_status(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_console_errors(integer, integer) from public, anon, authenticated;

grant execute on function public.admin_console_feedback(integer, integer, text) to service_role;
grant execute on function public.admin_console_set_feedback_status(uuid, text, uuid, text) to service_role;
grant execute on function public.admin_console_errors(integer, integer) to service_role;
