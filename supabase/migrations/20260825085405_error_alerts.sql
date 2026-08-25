-- Tell somebody when the app breaks, instead of waiting for them to look.
--
-- Errors have been written to app_error_logs and grouped by fingerprint in the
-- console for a while, but nothing has ever pushed. docs/OPERATIONS.md has said
-- so in "目前沒做的" since the console shipped: every signal in this product —
-- crashes, feedback, a stale backup — requires a person to decide, unprompted,
-- to go and look. That is not monitoring, it is a habit, and habits lapse.
--
-- The push machinery already exists (VAPID, push_subscriptions, the fan-out in
-- pushSender.ts), so this is the routing decision and nothing more.
--
-- The whole difficulty is NOT sending too much. A bug that breaks one screen
-- breaks it for everyone at once, so the naive version pushes once per
-- occurrence and is worse than silence — an admin who mutes Equo after the
-- first storm now gets no alerts at all. Three bounds, all enforced in one
-- atomic statement so that concurrent reports of the same crash cannot each
-- decide they are the first:
--
--   1. Per FINGERPRINT, not per occurrence. 200 users hitting one bug is one
--      alert. (error_log_fingerprint already normalises uuids and numbers out
--      of the message, so a fingerprint is a bug, not a string.)
--   2. A cooldown per fingerprint (default 6h). A bug that keeps firing all
--      afternoon does not keep pushing all afternoon.
--   3. A GLOBAL hourly cap (default 5). Twenty distinct new fingerprints in a
--      bad deploy is five alerts, not twenty.
--
-- Bound 3 is also the security control. POST /api/v1/errors is anonymous and
-- capped at 30/hour/IP, so without a global cap anyone could turn the crash
-- reporter into a way to buzz an administrator's phone thirty times an hour by
-- posting thirty distinct messages.


-- ============================================================
-- What has already been alerted about.
-- ============================================================
--
-- Deliberately separate from app_error_group_status, which records what a HUMAN
-- decided about a fingerprint (open / resolved). Merging them would mean an
-- admin resolving an error also silences the alert for its next recurrence —
-- exactly backwards, since a resolved bug coming back is the most interesting
-- alert there is.
CREATE TABLE IF NOT EXISTS "public"."app_error_alerts" (
  "fingerprint" "text" NOT NULL,
  "first_alerted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "last_alerted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "alert_count" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "app_error_alerts_pkey" PRIMARY KEY ("fingerprint")
);

ALTER TABLE "public"."app_error_alerts" OWNER TO "postgres";

-- Serves the hourly-cap check, which is the first thing every report does.
CREATE INDEX IF NOT EXISTS "app_error_alerts_last_idx"
  ON "public"."app_error_alerts" USING "btree" ("last_alerted_at" DESC);

-- Same posture as ops_heartbeats and api_rate_limits: service_role only, RLS on
-- with no policies so an accidental grant to anon/authenticated still denies.
ALTER TABLE "public"."app_error_alerts" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."app_error_alerts" TO "service_role";


-- ============================================================
-- Decide and record in one statement.
-- ============================================================
--
-- "Claim" rather than "should_alert" on purpose: asking and recording have to
-- be the same operation. Two reports of the same new crash arriving together
-- would otherwise both read "never alerted", both decide to send, and the one
-- thing this design exists to prevent happens on the very first bug.
--
-- The INSERT ... ON CONFLICT DO UPDATE ... WHERE does that: exactly one caller
-- gets a row back, and FOUND is false for everyone else. Postgres serialises
-- them on the primary key.
CREATE OR REPLACE FUNCTION "public"."claim_error_alert"(
  "p_message" "text",
  "p_source" "text",
  "p_cooldown_minutes" integer DEFAULT 360,
  "p_hourly_cap" integer DEFAULT 5
) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := now();
  v_fingerprint text := error_log_fingerprint(p_message, p_source);
  v_cooldown integer := greatest(coalesce(p_cooldown_minutes, 360), 1);
  v_cap integer := greatest(coalesce(p_hourly_cap, 5), 1);
  v_count integer;
  v_occurrences integer;
begin
  if v_fingerprint is null then
    return jsonb_build_object('alert', false, 'reason', 'no_fingerprint');
  end if;

  -- Checked before the upsert so a storm of distinct fingerprints stops writing
  -- rows too, not just stops sending.
  if (
    select count(*) from app_error_alerts
    where last_alerted_at > v_now - interval '1 hour'
  ) >= v_cap then
    return jsonb_build_object('alert', false, 'reason', 'hourly_cap', 'fingerprint', v_fingerprint);
  end if;

  insert into app_error_alerts as a (fingerprint, first_alerted_at, last_alerted_at, alert_count)
  values (v_fingerprint, v_now, v_now, 1)
  on conflict (fingerprint) do update
     set last_alerted_at = v_now,
         alert_count = a.alert_count + 1
   where a.last_alerted_at < v_now - make_interval(mins => v_cooldown)
  returning a.alert_count into v_count;

  if not found then
    return jsonb_build_object('alert', false, 'reason', 'cooldown', 'fingerprint', v_fingerprint);
  end if;

  -- Only counted once we have decided to send, so the cost is bounded by the
  -- hourly cap rather than paid on every crash report.
  select count(*) into v_occurrences
  from app_error_logs
  where created_at > v_now - interval '24 hours'
    and error_log_fingerprint(message, source) = v_fingerprint;

  return jsonb_build_object(
    'alert', true,
    -- 'new' is the first time this bug has ever been seen; 'recurring' is one
    -- that went quiet for at least the cooldown and came back.
    'reason', case when v_count = 1 then 'new' else 'recurring' end,
    'fingerprint', v_fingerprint,
    'occurrences_24h', v_occurrences
  );
end;
$$;

ALTER FUNCTION "public"."claim_error_alert"("text", "text", integer, integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."claim_error_alert"("text", "text", integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_error_alert"("text", "text", integer, integer) TO "service_role";


-- ============================================================
-- Who gets paged.
-- ============================================================
--
-- owner and admin only. 'support' is a console role for answering feedback, not
-- an on-call rota, and a phone buzzing at 3am for a crash you cannot deploy a
-- fix for is how people turn notifications off.
--
-- Same jsonb shape as push_targets_for_group so pushSender's fan-out takes it
-- unchanged; group_name/actor_name are null because neither applies.
CREATE OR REPLACE FUNCTION "public"."push_targets_for_admins"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'group_name', null,
    'actor_name', null,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      ))
      from push_subscriptions s
      where s.user_id in (
        select a.user_id from app_admins a where a.role in ('owner', 'admin')
      )
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."push_targets_for_admins"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."push_targets_for_admins"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."push_targets_for_admins"() TO "service_role";


-- ============================================================
-- Retention.
-- ============================================================
--
-- One row per distinct bug ever alerted on, so it grows slowly — but it grows,
-- and a fingerprint nobody has seen for a year should alert again if it comes
-- back rather than being suppressed by a row from last spring. Wired into the
-- nightly job next to the other purges.
CREATE OR REPLACE FUNCTION "public"."purge_error_alerts"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted bigint;
begin
  delete from app_error_alerts
  where last_alerted_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30));

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

ALTER FUNCTION "public"."purge_error_alerts"("p_days" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."purge_error_alerts"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_error_alerts"("p_days" integer) TO "service_role";
