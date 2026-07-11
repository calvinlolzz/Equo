-- Admin console: read RPC for the admin_audit_logs table so the /admin
-- 稽核 page can list what the phase-2 write RPCs have been recording.
-- Same security model as the rest of admin_console_*: SECURITY DEFINER,
-- EXECUTE for service_role only.

create or replace function public.admin_console_audit_logs(
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
    'total', (select count(*) from admin_audit_logs),
    'logs', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, admin_email, action, metadata, created_at
        from admin_audit_logs
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_console_audit_logs(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_console_audit_logs(integer, integer) to service_role;
