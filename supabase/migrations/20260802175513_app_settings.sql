-- Runtime configuration that an admin can change without a deploy.
--
-- Only one setting lives here so far: receipt recognition. It earns a table
-- rather than an env var for one reason — it is the only feature whose cost is
-- a per-call charge to an upstream model, so "turn it off right now" has to be
-- a thing somebody can do in thirty seconds rather than a redeploy. Swapping
-- the model is the same mechanism and comes along for free.
--
-- Deliberately a key/jsonb table and not a column per setting: each new setting
-- would otherwise be a migration, which is exactly the deploy this exists to
-- avoid. The shape of each value is enforced in the RPC below and again in the
-- route, not by the schema.
CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "updated_by_email" "text",
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "public"."app_settings" OWNER TO "postgres";

-- RLS on with no policies: the API reaches this only through service_role,
-- which bypasses RLS. Leaving it off would mean a future grant to anon or
-- authenticated silently exposes the whole table.
ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."app_settings" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."app_settings" FROM "anon";
REVOKE ALL ON TABLE "public"."app_settings" FROM "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";

-- Read the receipt-scan settings, with the defaults baked in.
--
-- Always returns a row-shaped object even when nothing has been saved, so the
-- scan path never has to special-case "no configuration yet" — a fresh
-- database behaves exactly like one where an admin left the defaults alone.
-- p_default_model is passed in by the caller so the env-var default and the
-- code default stay in one place (the server), not duplicated here.
CREATE OR REPLACE FUNCTION "public"."receipt_scan_settings"("p_default_model" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'enabled', coalesce((s.value ->> 'enabled')::boolean, true),
    'model', coalesce(nullif(s.value ->> 'model', ''), p_default_model),
    'updated_at', s.updated_at,
    'updated_by_email', s.updated_by_email
  )
  from (select 1) one
  left join app_settings s on s.key = 'receipt_scan';
$$;

ALTER FUNCTION "public"."receipt_scan_settings"("p_default_model" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."receipt_scan_settings"("p_default_model" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."receipt_scan_settings"("p_default_model" "text") TO "service_role";

-- Save the receipt-scan settings and record who did it, in one transaction.
--
-- The audit row is the point of doing this in a function rather than an upsert
-- from the app: "recognition was off all Tuesday" is a question somebody will
-- eventually ask, and the answer has to say who turned it off.
--
-- p_model is NOT validated against a list here on purpose. The allowlist is a
-- property of the deployed code (which models it knows how to call), so it
-- belongs with the code — a model added to the app must not need a migration,
-- and a model dropped from the app must not leave the database able to select
-- something the server will reject.
CREATE OR REPLACE FUNCTION "public"."admin_console_set_receipt_scan"(
    "p_actor" "uuid",
    "p_actor_email" "text",
    "p_enabled" boolean,
    "p_model" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row app_settings%rowtype;
begin
  insert into app_settings (key, value, updated_at, updated_by, updated_by_email)
  values (
    'receipt_scan',
    jsonb_build_object('enabled', p_enabled, 'model', p_model),
    now(),
    p_actor,
    p_actor_email
  )
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        updated_by_email = excluded.updated_by_email
  returning * into v_row;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    case when p_enabled then 'settings.receipt_scan.enable' else 'settings.receipt_scan.disable' end,
    jsonb_build_object('model', p_model, 'enabled', p_enabled)
  );

  return jsonb_build_object(
    'enabled', (v_row.value ->> 'enabled')::boolean,
    'model', v_row.value ->> 'model',
    'updated_at', v_row.updated_at,
    'updated_by_email', v_row.updated_by_email
  );
end
$$;

ALTER FUNCTION "public"."admin_console_set_receipt_scan"("p_actor" "uuid", "p_actor_email" "text", "p_enabled" boolean, "p_model" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_set_receipt_scan"("p_actor" "uuid", "p_actor_email" "text", "p_enabled" boolean, "p_model" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_receipt_scan"("p_actor" "uuid", "p_actor_email" "text", "p_enabled" boolean, "p_model" "text") TO "service_role";
