-- Admin console: manage who is an admin (owner-only feature).
--
-- app_admins was only editable by raw SQL - there was no way to see who has
-- console access or to grant/revoke it from the UI. These three functions back
-- an owner-only "admins" tab. Role gating (owner-only) is enforced in the
-- handler; the last-owner guard lives here so it's atomic with the write.
--
-- set/remove return { ok, ... } rather than raising, so a business failure
-- (no such user, demoting the last owner) becomes a clean 4xx in the handler
-- instead of a 500 from a raised exception.

CREATE OR REPLACE FUNCTION "public"."admin_console_admins"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', a.user_id,
      'email', u.email,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url,
      'role', a.role,
      'created_at', a.created_at
    ) order by
      case a.role when 'owner' then 0 when 'admin' then 1 else 2 end,
      u.email)
    from app_admins a
    left join users u on u.id = a.user_id
  ), '[]'::jsonb);
$$;

ALTER FUNCTION "public"."admin_console_admins"() OWNER TO "postgres";


-- Grant or change an admin's role, keyed by email (the admin list shows emails,
-- and "add someone" is naturally email-driven). Blocks demoting the sole owner.
CREATE OR REPLACE FUNCTION "public"."admin_console_set_admin_role"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_target_email" "text",
  "p_role" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user users%rowtype;
  v_old_role text;
  v_owner_count integer;
begin
  if p_role not in ('owner', 'admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ROLE');
  end if;

  select * into v_user from users where email = p_target_email and deleted_at is null;
  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select role into v_old_role from app_admins where user_id = v_user.id;

  -- Don't let the last owner be demoted - that would leave nobody able to
  -- manage admins.
  if v_old_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from app_admins where role = 'owner';
    if v_owner_count <= 1 then
      return jsonb_build_object('ok', false, 'error', 'LAST_OWNER');
    end if;
  end if;

  insert into app_admins (user_id, role)
  values (v_user.id, p_role)
  on conflict (user_id) do update set role = excluded.role;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    case when v_old_role is null then 'admin.grant' else 'admin.role_change' end,
    jsonb_build_object('user_id', v_user.id, 'email', v_user.email, 'role', p_role, 'previous_role', v_old_role)
  );

  return jsonb_build_object('ok', true, 'admin', jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'avatar_url', v_user.avatar_url,
    'role', p_role,
    'created_at', (select created_at from app_admins where user_id = v_user.id)
  ));
end
$$;

ALTER FUNCTION "public"."admin_console_set_admin_role"("p_actor" "uuid", "p_actor_email" "text", "p_target_email" "text", "p_role" "text") OWNER TO "postgres";


-- Revoke an admin, keyed by user_id (the list provides it). Blocks removing the
-- sole owner.
CREATE OR REPLACE FUNCTION "public"."admin_console_remove_admin"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_user_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_old_role text;
  v_owner_count integer;
  v_email text;
begin
  select role into v_old_role from app_admins where user_id = p_user_id;
  if v_old_role is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AN_ADMIN');
  end if;

  if v_old_role = 'owner' then
    select count(*) into v_owner_count from app_admins where role = 'owner';
    if v_owner_count <= 1 then
      return jsonb_build_object('ok', false, 'error', 'LAST_OWNER');
    end if;
  end if;

  select email into v_email from users where id = p_user_id;

  delete from app_admins where user_id = p_user_id;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'admin.remove',
    jsonb_build_object('user_id', p_user_id, 'email', v_email, 'previous_role', v_old_role)
  );

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end
$$;

ALTER FUNCTION "public"."admin_console_remove_admin"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") OWNER TO "postgres";


REVOKE ALL ON FUNCTION "public"."admin_console_admins"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_admins"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_console_set_admin_role"("p_actor" "uuid", "p_actor_email" "text", "p_target_email" "text", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_admin_role"("p_actor" "uuid", "p_actor_email" "text", "p_target_email" "text", "p_role" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_console_remove_admin"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_remove_admin"("p_actor" "uuid", "p_actor_email" "text", "p_user_id" "uuid") TO "service_role";
