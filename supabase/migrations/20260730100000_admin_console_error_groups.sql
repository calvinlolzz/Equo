-- Admin console: stop showing the error log as a flat river.
--
-- app_error_logs is append-only and the console listed it newest-first, one row
-- per occurrence. One broken build therefore filled every page with the same
-- message, and the two facts anyone actually wants - "is this one thing or
-- fifty" and "is it still happening" - had to be reconstructed by eye. Worse,
-- there was nowhere to write down that a problem had been dealt with, so the
-- page only ever grew and eventually stopped being read at all.
--
-- The fix is a grouping key over the message plus a per-key status:
--   * admin_console_error_groups  - one row per distinct error, with counts
--   * admin_console_errors        - unchanged flat list, now filterable to one
--                                   group so a row can be drilled into
--   * app_error_group_status      - "已處理", the only mutable state here


-- ============================================================
-- The grouping key.
-- ============================================================
--
-- Normalises the parts of a message that differ per occurrence but not per
-- cause - uuids, numbers (offsets, ports, ids, sizes), whitespace - then
-- hashes what is left together with the source. Two reports collapse into one
-- group exactly when they differ only in those.
--
-- Deliberately derived rather than stored: app_error_logs is written by the
-- public intake endpoint on the hot path, and adding a column would mean a
-- backfill plus a write-time cost for a read-time convenience. The table holds
-- error reports from a small user base - if it ever grows enough for the
-- group-by to matter, the answer is an index on this expression (it is
-- IMMUTABLE for exactly that reason), not a schema change.
--
-- search_path is pinned empty: every function it calls (md5, lower,
-- regexp_replace) lives in pg_catalog, which is always searched first, so
-- nothing here can be shadowed by a schema an attacker controls.
CREATE OR REPLACE FUNCTION "public"."error_log_fingerprint"("p_message" "text", "p_source" "text")
  RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select md5(
    coalesce(p_source, '') || '|' ||
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_message, '')),
          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'g'
        ),
        '[0-9]+', ':n', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

ALTER FUNCTION "public"."error_log_fingerprint"("text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."error_log_fingerprint"("text", "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."error_log_fingerprint"("text", "text") TO "service_role";


-- ============================================================
-- "We have dealt with this one."
-- ============================================================
--
-- Keyed by the fingerprint, not by a log row: the whole point is that the
-- status outlives the individual occurrences and applies to the next one that
-- arrives. A group that starts happening again after being resolved is
-- surfaced by last_seen, which the console shows next to the status.
--
-- The actor is recorded as an email rather than a user id on purpose, matching
-- admin_audit_logs: a foreign key here would be one more table blocking
-- account deletion (see delete_my_account) for an audit note that is more
-- useful as a readable string anyway.
CREATE TABLE IF NOT EXISTS "public"."app_error_group_status" (
  "fingerprint" "text" NOT NULL,
  "status" "text" DEFAULT 'open'::"text" NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_by_email" "text",
  CONSTRAINT "app_error_group_status_pkey" PRIMARY KEY ("fingerprint"),
  CONSTRAINT "app_error_group_status_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text"])))
);

ALTER TABLE "public"."app_error_group_status" OWNER TO "postgres";

-- Same posture as ops_heartbeats and api_rate_limits: service_role only, RLS on
-- with no policies so an accidental grant to anon/authenticated still denies.
ALTER TABLE "public"."app_error_group_status" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."app_error_group_status" TO "service_role";


-- ============================================================
-- The grouped list.
-- ============================================================
--
-- p_search filters the underlying rows BEFORE grouping, so searching narrows
-- both which groups appear and what their counts describe ("how often did this
-- happen to alice@"), which is the question a search is being used to ask.
--
-- user_count counts distinct non-null user_ids: reports from signed-out
-- sessions carry no user and so add nothing to it. A group with occurrences
-- well above user_count is one user in a crash loop, which is a materially
-- different problem from the same count spread across a hundred people - hence
-- both numbers.
CREATE OR REPLACE FUNCTION "public"."admin_console_error_groups"(
  "p_search" "text",
  "p_status" "text",
  "p_limit" integer,
  "p_offset" integer
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with matched as (
    select
      error_log_fingerprint(e.message, e.source) as fingerprint,
      e.source,
      e.message,
      e.page,
      e.user_id,
      e.created_at
    from app_error_logs e
    left join users u on u.id = e.user_id
    where (
      p_search is null or p_search = ''
      or e.message ilike '%' || p_search || '%'
      or e.context ilike '%' || p_search || '%'
      or e.page ilike '%' || p_search || '%'
      or u.email ilike '%' || p_search || '%'
    )
  ),
  grouped as (
    select
      m.fingerprint,
      m.source,
      -- The newest wording wins the sample: when a message's shape changes
      -- slightly between releases, the one on screen is the current one.
      (array_agg(m.message order by m.created_at desc))[1] as sample_message,
      (array_agg(m.page order by m.created_at desc))[1] as last_page,
      count(*)::int as occurrences,
      count(distinct m.user_id)::int as user_count,
      min(m.created_at) as first_seen,
      max(m.created_at) as last_seen
    from matched m
    group by m.fingerprint, m.source
  ),
  with_status as (
    select
      g.fingerprint,
      g.source,
      g.sample_message,
      g.last_page,
      g.occurrences,
      g.user_count,
      g.first_seen,
      g.last_seen,
      coalesce(s.status, 'open') as status,
      s.updated_at as status_updated_at,
      s.updated_by_email as status_updated_by
    from grouped g
    left join app_error_group_status s on s.fingerprint = g.fingerprint
  ),
  filtered as (
    select * from with_status
    where p_status is null or p_status = '' or p_status = 'all' or status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'groups', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select *
        from filtered
        order by last_seen desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_error_groups"("p_search" "text", "p_status" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_error_groups"("p_search" "text", "p_status" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_error_groups"("p_search" "text", "p_status" "text", "p_limit" integer, "p_offset" integer) TO "service_role";


-- ============================================================
-- The flat list, now drillable.
-- ============================================================
--
-- Same function as before with a fingerprint filter added, so the occurrences
-- behind one group are the existing list scoped to it rather than a second
-- near-identical query. Each row carries its own fingerprint, which is what
-- lets the console open a row's group from the unfiltered list.
DROP FUNCTION IF EXISTS "public"."admin_console_errors"("p_search" "text", "p_limit" integer, "p_offset" integer);

CREATE OR REPLACE FUNCTION "public"."admin_console_errors"(
  "p_search" "text",
  "p_fingerprint" "text",
  "p_limit" integer,
  "p_offset" integer
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select
      e.id,
      u.email as user_email,
      e.source,
      e.message,
      e.context,
      e.page,
      e.created_at,
      error_log_fingerprint(e.message, e.source) as fingerprint
    from app_error_logs e
    left join users u on u.id = e.user_id
    where (
      p_search is null or p_search = ''
      or e.message ilike '%' || p_search || '%'
      or e.context ilike '%' || p_search || '%'
      or e.page ilike '%' || p_search || '%'
      or u.email ilike '%' || p_search || '%'
    )
    and (
      p_fingerprint is null or p_fingerprint = ''
      or error_log_fingerprint(e.message, e.source) = p_fingerprint
    )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(page.*))
      from (
        select id, user_email, source, message, context, page, created_at, fingerprint
        from filtered
        order by created_at desc
        limit greatest(p_limit, 0)
        offset greatest(p_offset, 0)
      ) page
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_errors"("p_search" "text", "p_fingerprint" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_errors"("p_search" "text", "p_fingerprint" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_errors"("p_search" "text", "p_fingerprint" "text", "p_limit" integer, "p_offset" integer) TO "service_role";


-- ============================================================
-- Marking a group handled.
-- ============================================================
--
-- Returns null for a fingerprint no log row produces, so a hand-edited or
-- stale id cannot seed a status row for an error that does not exist. Audited
-- like every other console mutation.
CREATE OR REPLACE FUNCTION "public"."admin_console_set_error_group_status"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_fingerprint" "text",
  "p_status" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := now();
begin
  if p_status not in ('open', 'resolved') then
    raise exception 'invalid error group status: %', p_status;
  end if;

  if not exists (
    select 1 from app_error_logs e
    where error_log_fingerprint(e.message, e.source) = p_fingerprint
  ) then
    return null;
  end if;

  insert into app_error_group_status (fingerprint, status, updated_at, updated_by_email)
  values (p_fingerprint, p_status, v_now, p_actor_email)
  on conflict (fingerprint) do update
    set status = p_status,
        updated_at = v_now,
        updated_by_email = p_actor_email;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'error.status',
    jsonb_build_object('fingerprint', p_fingerprint, 'status', p_status)
  );

  return jsonb_build_object('fingerprint', p_fingerprint, 'status', p_status, 'updated_at', v_now);
end
$$;

ALTER FUNCTION "public"."admin_console_set_error_group_status"("p_actor" "uuid", "p_actor_email" "text", "p_fingerprint" "text", "p_status" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_set_error_group_status"("p_actor" "uuid", "p_actor_email" "text", "p_fingerprint" "text", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_error_group_status"("p_actor" "uuid", "p_actor_email" "text", "p_fingerprint" "text", "p_status" "text") TO "service_role";
