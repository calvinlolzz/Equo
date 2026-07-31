-- Group unread markers: "which of my groups has something new in it".
--
-- Someone in three or four groups currently has to open each one to find out
-- whether anybody recorded anything - the group list shows a name and a cover
-- and nothing about whether it moved since they last looked. That is the one
-- signal a phone app is expected to carry on its home screen.
--
-- Kept server-side rather than in localStorage because the alternative nags:
-- a read on the laptop would leave the dot showing on the phone, on an app
-- whose whole point is that several people share the same data.


-- When this member last looked at the group. NULL = never, which reads as
-- "everything since they joined is new" (see the coalesce below) rather than
-- "everything ever", so being added to a group with years of history does not
-- arrive as a badge with 400 on it.
ALTER TABLE "public"."group_members"
  ADD COLUMN IF NOT EXISTS "last_read_at" timestamp with time zone;


-- ============================================================
-- The counts.
-- ============================================================
--
-- Entries the caller has not seen, per group, excluding their own: recording
-- an expense must not leave a badge on the group you just recorded it in.
--
-- Authorship is compared on created_by_member_id, not expenses.created_by -
-- create_expense only ever writes the former (the latter exists on the table
-- but is left null by the RPC path the app uses, and an is-null row counts as
-- somebody else's, which is the safe direction for a "look at this" hint).
--
-- Only groups with something unread come back; the caller fills in zero for
-- the rest. Deleted and archived groups are excluded - neither appears in the
-- list this decorates.
CREATE OR REPLACE FUNCTION "public"."group_unread_counts"("p_user" "uuid")
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    jsonb_agg(jsonb_build_object('group_id', t.group_id, 'unread_count', t.unread_count)),
    '[]'::jsonb
  )
  from (
    select
      m.group_id,
      -- distinct, because a user with two membership rows in one group (the
      -- legacy shape this schema still permits) would otherwise double-count.
      count(distinct e.id)::int as unread_count
    from group_members m
    join groups g
      on g.id = m.group_id
      and g.archived_at is null
      and g.deleted_at is null
    join expenses e
      on e.group_id = m.group_id
      and e.deleted_at is null
      and e.created_at > coalesce(m.last_read_at, m.joined_at)
      and (e.created_by_member_id is null or e.created_by_member_id <> m.id)
    where m.user_id = p_user
      and m.status = 'active'
    group by m.group_id
  ) t;
$$;

ALTER FUNCTION "public"."group_unread_counts"("uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."group_unread_counts"("uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_unread_counts"("uuid") TO "service_role";


-- ============================================================
-- Marking one read.
-- ============================================================
--
-- Called when the caller opens a group. Scoped to their own membership rows by
-- p_user, so this cannot clear somebody else's badge; returns null when they
-- are not an active member, which the route turns into a 404 rather than a
-- silent success.
CREATE OR REPLACE FUNCTION "public"."mark_group_read"("p_user" "uuid", "p_group_id" "uuid")
  RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := now();
begin
  update group_members
  set last_read_at = v_now,
      updated_at = v_now
  where group_id = p_group_id
    and user_id = p_user
    and status = 'active';

  if not found then
    return null;
  end if;

  return jsonb_build_object('group_id', p_group_id, 'last_read_at', v_now);
end
$$;

ALTER FUNCTION "public"."mark_group_read"("uuid", "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."mark_group_read"("uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_group_read"("uuid", "uuid") TO "service_role";
