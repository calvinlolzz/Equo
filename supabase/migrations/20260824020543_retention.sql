-- Retention for the three tables that only ever grew.
--
-- app_error_logs, client_requests and invites had no purge of any kind: every
-- crash report, every idempotency key and every dead invite code written since
-- 2026-07-01 is still there. None of them is large today — that is exactly why
-- this is cheap to add now and awkward later, on a database whose free plan
-- stops at 500 MB and whose backup is a workflow artifact that has to stay
-- small enough to upload.
--
-- One window, 90 days, for all three. Not because the three are alike, but
-- because each one's real requirement is far shorter than 90 days (see the
-- reasoning on each function) and a single number is one thing to remember.
-- Every function clamps to a 30-day floor so a fat-fingered call cannot erase
-- the recent past.
--
-- All three are no-ops on today's data: nothing in any of these tables is yet
-- 90 days old. That is the intended way to ship a delete — it lands, it runs
-- nightly, and it starts removing rows only once rows are genuinely stale.


-- ============================================================
-- Crash reports.
-- ============================================================
--
-- The console pages app_error_logs with no time window at all, so this is the
-- only thing that bounds it. 90 days is well past any window the console
-- actually reasons about (24h and 7d on the health card, 30 days for open
-- error groups).
--
-- Orphaned status rows go too. app_error_group_status is keyed by a fingerprint
-- with no foreign key, so deleting logs would otherwise strand its rows
-- forever — and worse than the wasted space: a fingerprint marked 'resolved'
-- long ago would keep an error hidden if the same crash came back years later.
-- Dropping the status with the last of its logs means a returning error
-- correctly shows up as open again.
CREATE OR REPLACE FUNCTION "public"."purge_error_logs"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_days integer := greatest(coalesce(p_days, 90), 30);
  v_logs bigint;
  v_status bigint;
begin
  delete from app_error_logs
  where created_at < now() - make_interval(days => v_days);
  get diagnostics v_logs = row_count;

  delete from app_error_group_status s
  where not exists (
    select 1 from app_error_logs e
    where error_log_fingerprint(e.message, e.source) = s.fingerprint
  );
  get diagnostics v_status = row_count;

  return jsonb_build_object('logs_deleted', v_logs, 'status_rows_deleted', v_status);
end;
$$;

ALTER FUNCTION "public"."purge_error_logs"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."purge_error_logs"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_error_logs"("p_days" integer) TO "service_role";


-- ============================================================
-- Idempotency keys.
-- ============================================================
--
-- client_requests is pure replay protection: (group_id, client_request_id) ->
-- resource_id, checked at the top of create_expense / replace_expense /
-- delete_expense so a retry returns the original row instead of writing a
-- second one. Nothing else reads it, and no foreign key points at it.
--
-- Deleting a row therefore has exactly one consequence: a retry carrying that
-- same client_request_id would create a DUPLICATE EXPENSE. That is real
-- double-billing, so the window has to comfortably outlive any retry that can
-- still arrive.
--
-- It does. The dangerous sequence is narrow: the server processed the write,
-- the response was lost, and the client retries. The offline queue
-- (app/offlineQueue.ts) flushes on the next reconnect, so a real retry lands
-- minutes or hours later — never months. A device that was offline the whole
-- time never reached the server at all, so there is no row to preserve; its
-- write is a first arrival, not a replay.
--
-- 90 days is roughly two orders of magnitude more than that path needs.
--
-- Note the recurring-expense keys ('recur_<rule>_<date>', written by
-- materialise_recurring_expenses) live here too. They are what makes the
-- nightly job safe to re-run by hand — a re-run happens within hours, so 90
-- days covers it many times over.
CREATE OR REPLACE FUNCTION "public"."purge_client_requests"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted bigint;
begin
  delete from client_requests
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30));

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

ALTER FUNCTION "public"."purge_client_requests"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."purge_client_requests"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_client_requests"("p_days" integer) TO "service_role";


-- ============================================================
-- Dead invite codes.
-- ============================================================
--
-- Only DEAD invites are touched, and "dead" is the whole of the condition:
-- revoked, used up, or past an expiry it actually has. A live invite is never
-- purged however old it is, because the link is sitting in somebody's chat
-- history and deleting the row would break a join that still works.
--
-- Age alone would be the wrong rule, and measurably so: every one of the 29
-- invites in production has expires_at IS NULL (the API accepts an expiry, the
-- app never sends one), so an "expired" rule would match nothing and an
-- "older than N days" rule would revoke live codes by deletion.
--
-- The 90 days is there so the console keeps showing recent dead invites. The
-- group drill-down lists them precisely so an admin can see how a group is
-- being joined and spot a code that should have been revoked; purging one the
-- day it is revoked would take away the evidence along with the row.
CREATE OR REPLACE FUNCTION "public"."purge_dead_invites"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted bigint;
begin
  delete from invites
  where created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30))
    and (
      revoked_at is not null
      or use_count >= max_uses
      or (expires_at is not null and expires_at < now())
    );

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

ALTER FUNCTION "public"."purge_dead_invites"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."purge_dead_invites"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_dead_invites"("p_days" integer) TO "service_role";
