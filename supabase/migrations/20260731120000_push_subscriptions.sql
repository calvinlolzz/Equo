-- Web push subscriptions.
--
-- The one thing this app cannot do today is tell you something happened while
-- you were not looking at it. Everything else - the unread badge, the group
-- list - only works once you have already opened the app, which is the wrong
-- way round for "your flatmate just recorded the rent".
--
-- No third-party service is involved: the Web Push protocol talks straight to
-- whatever endpoint the browser hands out (Google's, Mozilla's, Apple's), and
-- the only credential is a VAPID keypair we hold ourselves.


-- One row per browser/device that has granted permission. The endpoint is the
-- push service's URL for that installation and is the natural key: the same
-- person on a phone and a laptop is two rows, and re-subscribing on one of them
-- replaces that row rather than adding a second.
CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  -- CASCADE, unlike the ledger tables: a subscription is not history, and
  -- delete_my_account should take it with the account rather than leave a live
  -- endpoint pointing at a user that no longer exists.
  "user_id" "uuid" NOT NULL,
  "endpoint" "text" NOT NULL,
  -- The subscription's public key and auth secret (RFC 8291). Without both,
  -- a payload cannot be encrypted for this endpoint.
  "p256dh" "text" NOT NULL,
  "auth" "text" NOT NULL,
  -- Which browser it was, for the console. Never used for delivery.
  "user_agent" "text",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "last_success_at" timestamp with time zone,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint"),
  CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "public"."users"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx"
  ON "public"."push_subscriptions" ("user_id");

-- Service-role only, RLS on with no policies - the same posture as every other
-- table the front end never touches directly.
ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";


-- ============================================================
-- Subscribe / unsubscribe.
-- ============================================================
--
-- Keyed on the endpoint so a device that re-subscribes (browsers rotate these
-- on their own schedule, and permission can be revoked and granted again)
-- updates in place. The conflict path also re-points the row at the current
-- user, which is what a shared computer does when the next person logs in.
CREATE OR REPLACE FUNCTION "public"."upsert_push_subscription"(
  "p_user" "uuid",
  "p_endpoint" "text",
  "p_p256dh" "text",
  "p_auth" "text",
  "p_user_agent" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
begin
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (p_user, p_endpoint, p_p256dh, p_auth, nullif(p_user_agent, ''))
  on conflict (endpoint) do update
    set user_id = p_user,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = coalesce(excluded.user_agent, push_subscriptions.user_agent)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'endpoint', p_endpoint);
end
$$;

ALTER FUNCTION "public"."upsert_push_subscription"("uuid", "text", "text", "text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."upsert_push_subscription"("uuid", "text", "text", "text", "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_push_subscription"("uuid", "text", "text", "text", "text") TO "service_role";


-- Scoped to the caller's own rows: turning notifications off on your phone
-- must not be able to turn them off on somebody else's.
CREATE OR REPLACE FUNCTION "public"."delete_push_subscription"("p_user" "uuid", "p_endpoint" "text")
  RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from push_subscriptions
  where endpoint = p_endpoint and user_id = p_user;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end
$$;

ALTER FUNCTION "public"."delete_push_subscription"("uuid", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."delete_push_subscription"("uuid", "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_push_subscription"("uuid", "text") TO "service_role";


-- A push service answering 404/410 means the subscription is gone for good.
-- Not scoped to a user: the caller here is the delivery path, which only knows
-- the endpoint it just failed to reach.
CREATE OR REPLACE FUNCTION "public"."prune_push_subscription"("p_endpoint" "text")
  RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end
$$;

ALTER FUNCTION "public"."prune_push_subscription"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."prune_push_subscription"("text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_push_subscription"("text") TO "service_role";


-- ============================================================
-- Who to notify about something in a group.
-- ============================================================
--
-- Returns the group's name and the actor's display name alongside the
-- endpoints, because the delivery path needs all three to write the
-- notification and this saves it two more round trips on the write path.
--
-- Excludes the actor: nobody needs to be told about the expense they just
-- recorded. Members without an account (virtual members) have no user_id and
-- therefore no subscriptions, so they fall out naturally.
CREATE OR REPLACE FUNCTION "public"."push_targets_for_group"("p_group_id" "uuid", "p_actor" "uuid")
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'group_name', (select name from groups where id = p_group_id),
    'actor_name', (
      select display_name from group_members
      where group_id = p_group_id and user_id = p_actor and status = 'active'
      limit 1
    ),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      ))
      from push_subscriptions s
      where s.user_id in (
        select m.user_id
        from group_members m
        where m.group_id = p_group_id
          and m.status = 'active'
          and m.user_id is not null
          and m.user_id <> p_actor
      )
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."push_targets_for_group"("uuid", "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."push_targets_for_group"("uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."push_targets_for_group"("uuid", "uuid") TO "service_role";
