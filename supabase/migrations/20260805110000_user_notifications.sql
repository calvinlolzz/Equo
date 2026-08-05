-- In-app notifications: a place for the service to say something to a person.
--
-- Everything the product has to tell a user currently has to be a web push,
-- which means it reaches nobody who declined the permission prompt, nothing on
-- iOS unless the app was installed to the home screen, and nothing at all that
-- is worth reading twice - a push is a flash of text, not a record.
--
-- The concrete gap this closes is feedback. A user writes in, an admin reads it
-- in the console, marks it 已處理, and the user never learns that anyone saw it.
-- With an inbox the reply has somewhere to land, and the same mechanism carries
-- announcements without needing the push permission at all.
--
-- Push is not replaced by this and not wired into it here: the two answer
-- different questions ("tell me now" vs "what was I told"), and the inbox has
-- to work for the majority who never granted push before it is worth teaching
-- them to travel together.

CREATE TABLE IF NOT EXISTS "public"."user_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    -- What produced it, so the client can pick an icon and the console can
    -- report on announcements without counting replies.
    "kind" "text" DEFAULT 'announcement'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    -- An in-app path (e.g. /group/<id>) the row links to. Same-origin only,
    -- enforced by the client: a notification is not a place to put a URL.
    "link" "text",
    -- The feedback this is a reply to, when it is one. Kept so the console can
    -- show a thread rather than a disconnected message.
    "source_feedback_id" "uuid",
    "created_by" "uuid",
    "created_by_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_notifications_kind_check" CHECK (("kind" = ANY (ARRAY['announcement'::"text", 'feedback_reply'::"text"])))
);

ALTER TABLE "public"."user_notifications" OWNER TO "postgres";

-- CASCADE, like push_subscriptions and unlike the ledger tables: a message to
-- somebody is not shared history, and account deletion should take it along
-- rather than leave rows addressed to a user that no longer exists.
ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_source_feedback_id_fkey" FOREIGN KEY ("source_feedback_id") REFERENCES "public"."app_feedback"("id") ON DELETE SET NULL;

-- The inbox query, and only it: newest first for one user. The partial index
-- serves the unread count, which is read on every app open and is the one
-- number that has to be cheap.
CREATE INDEX IF NOT EXISTS "user_notifications_user_created_idx"
    ON "public"."user_notifications" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "user_notifications_unread_idx"
    ON "public"."user_notifications" ("user_id")
    WHERE ("read_at" IS NULL);

-- RLS on with no policies, matching app_settings: the API reaches this only
-- through service_role (which bypasses RLS), and leaving it off would mean a
-- future grant to authenticated silently exposes everyone's inbox.
ALTER TABLE "public"."user_notifications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_notifications" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."user_notifications" FROM "anon";
REVOKE ALL ON TABLE "public"."user_notifications" FROM "authenticated";
GRANT ALL ON TABLE "public"."user_notifications" TO "service_role";

-- ---------------------------------------------------------------------------
-- Reading the inbox.
-- ---------------------------------------------------------------------------

-- One user's inbox plus their unread count.
--
-- Both in one call because the client wants both at once (the bell's badge and
-- the panel behind it), and because an unread count fetched separately from the
-- list it describes is a badge that disagrees with the screen.
--
-- The count is over ALL unread rows, not just the returned page: "3 unread" has
-- to stay true when the newest 30 happen to be read.
CREATE OR REPLACE FUNCTION "public"."notifications_list"("p_user_id" "uuid", "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'unread', (select count(*) from user_notifications where user_id = p_user_id and read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'kind', n.kind,
        'title', n.title,
        'body', n.body,
        'link', n.link,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) order by n.created_at desc)
      from (
        select * from user_notifications
        where user_id = p_user_id
        order by created_at desc
        limit greatest(least(p_limit, 100), 1)
      ) n
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."notifications_list"("p_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notifications_list"("p_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notifications_list"("p_user_id" "uuid", "p_limit" integer) TO "service_role";

-- Mark rows read. An empty/NULL id array means "all of them", which is what the
-- panel does on open; a specific list is for marking one row from the list.
--
-- Scoped by user_id in the UPDATE itself rather than checked beforehand: that
-- is what makes an id from someone else's inbox a no-op instead of a leak, and
-- it cannot be forgotten the way a separate guard can.
CREATE OR REPLACE FUNCTION "public"."notifications_mark_read"("p_user_id" "uuid", "p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_marked int := 0;
begin
  update user_notifications
  set read_at = now()
  where user_id = p_user_id
    and read_at is null
    and (p_ids is null or cardinality(p_ids) = 0 or id = any(p_ids));
  get diagnostics v_marked = row_count;

  return jsonb_build_object(
    'marked', v_marked,
    'unread', (select count(*) from user_notifications where user_id = p_user_id and read_at is null)
  );
end
$$;

ALTER FUNCTION "public"."notifications_mark_read"("p_user_id" "uuid", "p_ids" "uuid"[]) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notifications_mark_read"("p_user_id" "uuid", "p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notifications_mark_read"("p_user_id" "uuid", "p_ids" "uuid"[]) TO "service_role";

-- ---------------------------------------------------------------------------
-- Writing to it, from the console.
-- ---------------------------------------------------------------------------

-- Send one message to an audience.
--
-- The audiences are deliberately few and each is a question somebody actually
-- asks: this one person (support follow-up), everyone in this group (something
-- happened to their data), everyone who has opened the app recently
-- (maintenance, a change worth knowing about), everyone.
--
-- 'active' exists so that "tell the users" does not have to mean waking up
-- every account that has ever existed. Disabled accounts are excluded from all
-- of them - they cannot log in to read it.
--
-- Returns the recipient count because that is the number the person clicking
-- send needs to see BEFORE they believe it worked, and the audit row keeps it.
CREATE OR REPLACE FUNCTION "public"."admin_console_send_notification"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_audience" "text",
  "p_target" "uuid",
  "p_title" "text",
  "p_body" "text",
  "p_link" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_recipients int := 0;
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
begin
  if v_title = '' or v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_MESSAGE');
  end if;

  if p_audience not in ('user', 'group', 'active', 'all') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AUDIENCE');
  end if;

  if p_audience in ('user', 'group') and p_target is null then
    return jsonb_build_object('ok', false, 'error', 'TARGET_REQUIRED');
  end if;

  if p_audience = 'user' and not exists (select 1 from users where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  end if;

  if p_audience = 'group' and not exists (select 1 from groups where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  end if;

  insert into user_notifications (user_id, kind, title, body, link, created_by, created_by_email)
  select u.id, 'announcement', v_title, v_body, v_link, p_actor, p_actor_email
  from users u
  where u.deleted_at is null
    and case p_audience
      when 'user' then u.id = p_target
      when 'group' then exists (
        select 1 from group_members m
        where m.group_id = p_target and m.user_id = u.id and m.status = 'active'
      )
      -- users.updated_at is refreshed by the login upsert, so it doubles as
      -- "last seen" everywhere else in the console too.
      when 'active' then u.updated_at > now() - interval '30 days'
      else true
    end;
  get diagnostics v_recipients = row_count;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'notification.send',
    jsonb_build_object(
      'audience', p_audience,
      'target', p_target,
      'title', v_title,
      'recipients', v_recipients
    )
  );

  return jsonb_build_object('ok', true, 'recipients', v_recipients);
end
$$;

ALTER FUNCTION "public"."admin_console_send_notification"("p_actor" "uuid", "p_actor_email" "text", "p_audience" "text", "p_target" "uuid", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_send_notification"("p_actor" "uuid", "p_actor_email" "text", "p_audience" "text", "p_target" "uuid", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_send_notification"("p_actor" "uuid", "p_actor_email" "text", "p_audience" "text", "p_target" "uuid", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";

-- Reply to a piece of feedback: the notification and the status change together.
--
-- One function rather than "send a notification" plus "set the status", because
-- a reply that lands without closing the item leaves it in the queue for the
-- next person to answer again, and a status change without the reply is the
-- silence this whole migration exists to fix.
--
-- Anonymous feedback (user_id is null - it can be submitted signed-out) has
-- nowhere to reply to, and says so rather than failing quietly.
CREATE OR REPLACE FUNCTION "public"."admin_console_reply_feedback"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_feedback_id" "uuid",
  "p_message" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_feedback app_feedback%rowtype;
  v_message text := btrim(p_message);
  v_notification_id uuid;
begin
  if v_message = '' then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_MESSAGE');
  end if;

  select * into v_feedback from app_feedback where id = p_feedback_id;

  if v_feedback.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  if v_feedback.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_ACCOUNT');
  end if;

  insert into user_notifications (user_id, kind, title, body, source_feedback_id, created_by, created_by_email)
  values (
    v_feedback.user_id,
    'feedback_reply',
    '你的意見有回覆了',
    v_message,
    v_feedback.id,
    p_actor,
    p_actor_email
  )
  returning id into v_notification_id;

  update app_feedback set status = 'done' where id = p_feedback_id;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'feedback.reply',
    jsonb_build_object('feedback_id', p_feedback_id, 'user_id', v_feedback.user_id)
  );

  return jsonb_build_object(
    'ok', true,
    'feedback_id', p_feedback_id,
    'notification_id', v_notification_id,
    'status', 'done'
  );
end
$$;

ALTER FUNCTION "public"."admin_console_reply_feedback"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_message" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_reply_feedback"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_reply_feedback"("p_actor" "uuid", "p_actor_email" "text", "p_feedback_id" "uuid", "p_message" "text") TO "service_role";
