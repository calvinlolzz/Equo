-- Admin console: search/filter for the audit and error logs.
--
-- Both log RPCs only took (limit, offset) - fine at a few dozen rows, useless
-- once the logs grow, since the only way to find "what did admin X do" or "every
-- occurrence of error Y" was to page through everything. This adds:
--   audit:  p_search (admin email or the target's name/email in metadata)
--           p_action (exact action, e.g. 'group.delete'; '' / 'all' = any)
--   errors: p_search (message, context, page, or the reporter's email)
--
-- The argument list changes, so the old (integer, integer) signatures are
-- dropped and replaced - PostgREST resolves by name+args and the repository now
-- passes the new shape. Grants are re-established for the new signatures.

DROP FUNCTION IF EXISTS "public"."admin_console_audit_logs"(integer, integer);

CREATE OR REPLACE FUNCTION "public"."admin_console_audit_logs"(
  "p_search" "text",
  "p_action" "text",
  "p_limit" integer,
  "p_offset" integer
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select l.*
    from admin_audit_logs l
    where (coalesce(nullif(p_action, ''), 'all') = 'all' or l.action = p_action)
      and (
        p_search is null or p_search = ''
        or l.admin_email ilike '%' || p_search || '%'
        or (l.metadata ->> 'name') ilike '%' || p_search || '%'
        or (l.metadata ->> 'email') ilike '%' || p_search || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'logs', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, admin_email, action, metadata, created_at
        from filtered
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_audit_logs"("p_search" "text", "p_action" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_audit_logs"("p_search" "text", "p_action" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_audit_logs"("p_search" "text", "p_action" "text", "p_limit" integer, "p_offset" integer) TO "service_role";


DROP FUNCTION IF EXISTS "public"."admin_console_errors"(integer, integer);

CREATE OR REPLACE FUNCTION "public"."admin_console_errors"(
  "p_search" "text",
  "p_limit" integer,
  "p_offset" integer
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select e.id, u.email as user_email, e.source, e.message, e.context, e.page, e.created_at
    from app_error_logs e
    left join users u on u.id = e.user_id
    where (
      p_search is null or p_search = ''
      or e.message ilike '%' || p_search || '%'
      or e.context ilike '%' || p_search || '%'
      or e.page ilike '%' || p_search || '%'
      or u.email ilike '%' || p_search || '%'
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, user_email, source, message, context, page, created_at
        from filtered
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_errors"("p_search" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_errors"("p_search" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_errors"("p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";
