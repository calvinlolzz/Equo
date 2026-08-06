-- Managing notifications, on both sides of the glass.
--
-- The inbox shipped as write-once: the console could send and the user could
-- read, and that was the entire vocabulary. Nobody could see what had been
-- sent, take back a message with a typo in it, tidy their own inbox, or stop
-- the table growing forever.
--
-- The structural problem behind most of that is that one "send" is stored as
-- one row per recipient, so there was no such thing as a message to look at
-- afterwards - only N copies of it. Grouping them back together by
-- (title, body, timestamp) would be a guess that breaks the first time two
-- announcements share a title. So a send now stamps a batch id, and that is
-- what the console lists, counts and recalls.

-- ---------------------------------------------------------------------------
-- Identity for a send
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."user_notifications"
    ADD COLUMN IF NOT EXISTS "batch_id" "uuid";

-- Denormalised onto every row of the batch. It is a property of the send, not
-- of the recipient, but keeping it here means the console's list is one query
-- against one table rather than a join to the audit log - which is a record of
-- what an admin did, not a source of truth about what exists.
ALTER TABLE "public"."user_notifications"
    ADD COLUMN IF NOT EXISTS "audience" "text";

-- Rows that predate this migration still have to be listable and recallable.
-- The tuple below is exactly what one insert produced (a single statement, so
-- created_at is identical across the batch), which makes it a safe one-off
-- reconstruction even though it would be a bad rule to rely on going forward.
UPDATE "public"."user_notifications" n
   SET "batch_id" = g."batch_id"
  FROM (
    SELECT "title", "body", "created_at", "created_by", "gen_random_uuid"() AS "batch_id"
      FROM "public"."user_notifications"
     WHERE "batch_id" IS NULL
     GROUP BY "title", "body", "created_at", "created_by"
  ) g
 WHERE n."batch_id" IS NULL
   AND n."title" = g."title"
   AND n."body" = g."body"
   AND n."created_at" = g."created_at"
   AND n."created_by" IS NOT DISTINCT FROM g."created_by";

CREATE INDEX IF NOT EXISTS "user_notifications_batch_idx"
    ON "public"."user_notifications" ("batch_id");

-- Serves the purge: "read, and older than N days".
CREATE INDEX IF NOT EXISTS "user_notifications_read_at_idx"
    ON "public"."user_notifications" ("read_at")
    WHERE ("read_at" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Sending, now stamped
-- ---------------------------------------------------------------------------

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
  v_batch uuid := gen_random_uuid();
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

  insert into user_notifications (user_id, kind, title, body, link, created_by, created_by_email, batch_id, audience)
  select u.id, 'announcement', v_title, v_body, v_link, p_actor, p_actor_email, v_batch, p_audience
  from users u
  where u.deleted_at is null
    and case p_audience
      when 'user' then u.id = p_target
      when 'group' then exists (
        select 1 from group_members m
        where m.group_id = p_target and m.user_id = u.id and m.status = 'active'
      )
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
      'recipients', v_recipients,
      'batch_id', v_batch
    )
  );

  return jsonb_build_object('ok', true, 'recipients', v_recipients, 'batch_id', v_batch);
end
$$;

ALTER FUNCTION "public"."admin_console_send_notification"("p_actor" "uuid", "p_actor_email" "text", "p_audience" "text", "p_target" "uuid", "p_title" "text", "p_body" "text", "p_link" "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_send_notification"("p_actor" "uuid", "p_actor_email" "text", "p_audience" "text", "p_target" "uuid", "p_title" "text", "p_body" "text", "p_link" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_send_notification"("p_actor" "uuid", "p_actor_email" "text", "p_audience" "text", "p_target" "uuid", "p_title" "text", "p_body" "text", "p_link" "text") TO "service_role";

-- Replies get a batch of one, so the console's "sent" list is everything the
-- console sent - not everything except the replies.
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

  insert into user_notifications (
    user_id, kind, title, body, source_feedback_id, created_by, created_by_email, batch_id, audience
  )
  values (
    v_feedback.user_id,
    'feedback_reply',
    '你的意見有回覆了',
    v_message,
    v_feedback.id,
    p_actor,
    p_actor_email,
    gen_random_uuid(),
    'user'
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

-- ---------------------------------------------------------------------------
-- What was sent, and how much of it was read
-- ---------------------------------------------------------------------------

-- One row per send, with the number it reached and the number that has been
-- opened.
--
-- The read count is the reason this exists: "did the announcement land" is
-- otherwise unanswerable, and an announcement nobody opened is a different
-- problem from one that was never delivered.
CREATE OR REPLACE FUNCTION "public"."admin_console_sent_notifications"(
  "p_limit" integer,
  "p_offset" integer
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with batches as (
    select
      n.batch_id,
      min(n.kind) as kind,
      min(n.title) as title,
      min(n.body) as body,
      min(n.link) as link,
      min(n.audience) as audience,
      min(n.created_by_email) as created_by_email,
      min(n.created_at) as created_at,
      count(*) as recipients,
      count(*) filter (where n.read_at is not null) as read_count
    from user_notifications n
    where n.batch_id is not null
    group by n.batch_id
  )
  select jsonb_build_object(
    'total', (select count(*) from batches),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', b.batch_id,
        'kind', b.kind,
        'title', b.title,
        'body', b.body,
        'link', b.link,
        'audience', b.audience,
        'created_by_email', b.created_by_email,
        'created_at', b.created_at,
        'recipients', b.recipients,
        'read_count', b.read_count
      ) order by b.created_at desc)
      from (
        select * from batches
        order by created_at desc
        limit greatest(least(p_limit, 100), 1)
        offset greatest(p_offset, 0)
      ) b
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."admin_console_sent_notifications"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_sent_notifications"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_sent_notifications"("p_limit" integer, "p_offset" integer) TO "service_role";

-- Take a send back: remove every copy of it from every inbox.
--
-- A hard delete, not a flag. This is a message, not a ledger entry - there is
-- no downstream arithmetic that depends on it having existed, and leaving
-- tombstones in everyone's inbox to represent "a thing you were told, withdrawn"
-- would be worse than it simply being gone.
--
-- The audit row keeps what it was, and how many people had already opened it
-- before it was pulled - because those people did read it, and the recall does
-- not undo that.
CREATE OR REPLACE FUNCTION "public"."admin_console_delete_notification_batch"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_batch_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_title text;
  v_recipients int;
  v_read int;
  v_deleted int := 0;
begin
  select min(title), count(*), count(*) filter (where read_at is not null)
    into v_title, v_recipients, v_read
    from user_notifications
   where batch_id = p_batch_id;

  if v_recipients is null or v_recipients = 0 then
    return null;
  end if;

  delete from user_notifications where batch_id = p_batch_id;
  get diagnostics v_deleted = row_count;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'notification.delete',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'title', v_title,
      'deleted', v_deleted,
      'already_read', v_read
    )
  );

  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'already_read', v_read, 'title', v_title);
end
$$;

ALTER FUNCTION "public"."admin_console_delete_notification_batch"("p_actor" "uuid", "p_actor_email" "text", "p_batch_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_delete_notification_batch"("p_actor" "uuid", "p_actor_email" "text", "p_batch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_delete_notification_batch"("p_actor" "uuid", "p_actor_email" "text", "p_batch_id" "uuid") TO "service_role";

-- ---------------------------------------------------------------------------
-- The reader's own housekeeping
-- ---------------------------------------------------------------------------

-- Delete rows from one person's inbox. An empty/NULL id array means all of
-- them, which is what 清空 does.
--
-- Scoped by user_id inside the DELETE for the same reason notifications_mark_read
-- is: that is what makes somebody else's id a no-op rather than a way to delete
-- their mail, and it cannot be forgotten the way a separate guard can.
CREATE OR REPLACE FUNCTION "public"."notifications_delete"("p_user_id" "uuid", "p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted int := 0;
begin
  delete from user_notifications
  where user_id = p_user_id
    and (p_ids is null or cardinality(p_ids) = 0 or id = any(p_ids));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'unread', (select count(*) from user_notifications where user_id = p_user_id and read_at is null)
  );
end
$$;

ALTER FUNCTION "public"."notifications_delete"("p_user_id" "uuid", "p_ids" "uuid"[]) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notifications_delete"("p_user_id" "uuid", "p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notifications_delete"("p_user_id" "uuid", "p_ids" "uuid"[]) TO "service_role";

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Drop read notifications older than p_days.
--
-- Only READ ones: an unread notification has not done its job yet, and expiring
-- it would silently cancel a message the person never saw. Unread rows stay
-- until they are read or recalled, however old they get.
--
-- Called nightly from the db-backup workflow rather than from pg_cron, so that
-- (a) it runs AFTER the dump, meaning anything it removes is already in that
-- night's backup, and (b) a failure turns a workflow red instead of failing
-- silently inside the database.
CREATE OR REPLACE FUNCTION "public"."purge_read_notifications"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_days int := greatest(coalesce(p_days, 7), 1);
  v_deleted int := 0;
begin
  delete from user_notifications
  where read_at is not null
    and read_at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted, 'older_than_days', v_days);
end
$$;

ALTER FUNCTION "public"."purge_read_notifications"("p_days" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."purge_read_notifications"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_read_notifications"("p_days" integer) TO "service_role";
