-- Two things the group list cannot answer today.
--
-- 1. "Do I owe anything?" The list shows a name, a cover and an unread badge.
--    The number everybody actually opens the app for - what this group costs
--    me right now - is one screen deeper, per group, every time.
--
-- 2. "Can you pay me back?" The balance is visible inside a group but there is
--    no way to say anything about it. People leave the app and go type it into
--    a chat, which is where split-bill apps lose the argument.


-- ============================================================
-- 1. The caller's own balance, per group.
-- ============================================================
--
-- Same decoration shape as group_unread_counts: one round trip alongside the
-- list rather than a second endpoint, because a list rendered without the
-- numbers and then patched is a list that visibly jumps.
--
-- Filtered to the group's own currency. Expenses are always written in it
-- (the composer converts, keeping the original in source_currency), so the
-- balances view only ever holds one currency per group in practice - and if a
-- legacy row in another one exists, silently adding it to the total would
-- produce a number that is not money in any currency.
--
-- Groups with no expenses yet have no row in the view at all; the left join
-- plus coalesce is what makes those come back as 0 instead of going missing,
-- since the caller matches these onto the list by group id.
CREATE OR REPLACE FUNCTION "public"."group_balances_for_user"("p_user" "uuid")
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'group_id', t.group_id,
      'balance_minor', t.balance_minor,
      'currency', t.currency
    )),
    '[]'::jsonb
  )
  from (
    select
      m.group_id,
      g.currency,
      coalesce(sum(b.balance_minor), 0)::int as balance_minor
    from group_members m
    join groups g
      on g.id = m.group_id
      and g.archived_at is null
      and g.deleted_at is null
    left join group_member_balances b
      on b.group_id = m.group_id
      and b.member_id = m.id
      and b.currency = g.currency
    where m.user_id = p_user
      and m.status = 'active'
    group by m.group_id, g.currency
  ) t;
$$;

ALTER FUNCTION "public"."group_balances_for_user"("uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."group_balances_for_user"("uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_balances_for_user"("uuid") TO "service_role";


-- ============================================================
-- 2. Nudges.
-- ============================================================
--
-- One row per reminder sent. Kept rather than fire-and-forget for one reason:
-- the cooldown below is enforced against it. It doubles as the answer to "who
-- has been pestering whom", which is the first thing anyone would ask if this
-- feature ever went wrong.
--
-- Both member references cascade with the membership row - a nudge is not
-- financial history and nothing depends on it, unlike the ledger tables that
-- are deliberately RESTRICT.
CREATE TABLE IF NOT EXISTS "public"."group_nudges" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "group_id" "uuid" NOT NULL,
  "from_member_id" "uuid" NOT NULL,
  "to_member_id" "uuid" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "group_nudges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_nudges_group_id_fkey" FOREIGN KEY ("group_id")
    REFERENCES "public"."groups"("id") ON DELETE CASCADE,
  CONSTRAINT "group_nudges_from_member_id_fkey" FOREIGN KEY ("from_member_id")
    REFERENCES "public"."group_members"("id") ON DELETE CASCADE,
  CONSTRAINT "group_nudges_to_member_id_fkey" FOREIGN KEY ("to_member_id")
    REFERENCES "public"."group_members"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."group_nudges" OWNER TO "postgres";

-- The cooldown lookup: newest nudge aimed at one member of one group.
CREATE INDEX IF NOT EXISTS "group_nudges_target_idx"
  ON "public"."group_nudges" ("group_id", "to_member_id", "created_at" DESC);

ALTER TABLE "public"."group_nudges" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."group_nudges" TO "service_role";


-- Send one, or explain why not.
--
-- Every refusal is a named status rather than an exception, because each one
-- means something different to the person who pressed the button: already
-- settled, too soon, or a member who has no account to notify.
--
-- The cooldown is per (group, target) and NOT per sender. Five people each
-- reminding the same person once is exactly the pile-on this is here to
-- prevent, and the receiver cannot tell the difference between one app and
-- five - to them it is just their phone going off five times about one debt.
--
-- Only a member who owes the group can be nudged (balance < 0). Reminding
-- somebody who is owed money is never anything but a mistake.
CREATE OR REPLACE FUNCTION "public"."send_nudge"(
  "p_user" "uuid",
  "p_group_id" "uuid",
  "p_to_member_id" "uuid",
  "p_cooldown_seconds" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_group groups%rowtype;
  v_from group_members%rowtype;
  v_to group_members%rowtype;
  v_balance integer;
  v_last timestamptz;
  v_retry integer;
begin
  select * into v_group
  from groups
  where id = p_group_id
    and archived_at is null
    and deleted_at is null;

  if not found then
    -- Null is "you have no business here", which the caller turns into the
    -- same 403 a non-member gets: a missing group and a group you are not in
    -- must not be distinguishable from outside.
    return null;
  end if;

  select * into v_from
  from group_members
  where group_id = p_group_id
    and user_id = p_user
    and status = 'active'
  order by joined_at
  limit 1;

  if not found then
    return null;
  end if;

  select * into v_to
  from group_members
  where id = p_to_member_id
    and group_id = p_group_id
    and status = 'active';

  if not found then
    return jsonb_build_object('status', 'member_not_found');
  end if;

  -- A virtual member has no account, so there is nothing to deliver to; and
  -- nudging yourself is a no-op the UI should never offer.
  if v_to.id = v_from.id or v_to.user_id is null then
    return jsonb_build_object('status', 'invalid_target');
  end if;

  select coalesce(sum(b.balance_minor), 0)::int into v_balance
  from group_member_balances b
  where b.group_id = p_group_id
    and b.member_id = v_to.id
    and b.currency = v_group.currency;

  if v_balance >= 0 then
    return jsonb_build_object('status', 'settled');
  end if;

  select max(created_at) into v_last
  from group_nudges
  where group_id = p_group_id
    and to_member_id = v_to.id;

  if v_last is not null and v_last > now() - make_interval(secs => p_cooldown_seconds) then
    v_retry := ceil(
      extract(epoch from (v_last + make_interval(secs => p_cooldown_seconds)) - now())
    )::int;

    return jsonb_build_object(
      'status', 'cooldown',
      'retry_after_seconds', greatest(v_retry, 1)
    );
  end if;

  insert into group_nudges (group_id, from_member_id, to_member_id)
  values (p_group_id, v_from.id, v_to.id);

  return jsonb_build_object(
    'status', 'sent',
    'group_name', v_group.name,
    'from_name', v_from.display_name,
    'to_user_id', v_to.user_id,
    'to_name', v_to.display_name,
    'balance_minor', v_balance,
    'currency', v_group.currency
  );
end
$$;

ALTER FUNCTION "public"."send_nudge"("uuid", "uuid", "uuid", integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."send_nudge"("uuid", "uuid", "uuid", integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_nudge"("uuid", "uuid", "uuid", integer) TO "service_role";


-- The endpoints of ONE member of a group - the nudge's recipient.
--
-- Separate from push_targets_for_group (everyone except the actor) rather than
-- a parameter on it: the two have opposite shapes, and a single function that
-- sometimes excludes and sometimes includes is the kind that eventually sends
-- a private reminder to the whole group.
CREATE OR REPLACE FUNCTION "public"."push_targets_for_member"("p_group_id" "uuid", "p_member_id" "uuid")
  RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'group_name', (select name from groups where id = p_group_id),
    'actor_name', null::text,
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
        where m.id = p_member_id
          and m.group_id = p_group_id
          and m.status = 'active'
          and m.user_id is not null
      )
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."push_targets_for_member"("uuid", "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."push_targets_for_member"("uuid", "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."push_targets_for_member"("uuid", "uuid") TO "service_role";
