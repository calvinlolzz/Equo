-- 自動催繳: remind somebody who has owed money for a while.
--
-- Manual nudging has existed since group_balances_and_nudges: you tap a button,
-- the person who owes you gets a push, and a 6-hour cooldown stops a double tap
-- arriving twice. What it needs is somebody remembering to tap it.
--
-- Three decisions worth writing down, because each had an obvious wrong answer.
--
-- 1. THE REMINDER GOES TO THE DEBTOR, and carries no sender.
--    The same direction the manual nudge already goes — "被提醒還款" is a thing
--    that happens TO the person who owes. What changes is that no human pressed
--    anything, so no name is attached: "你在「室友」還有 NT$1,200 未結清", not
--    "Alice 提醒你...". Nobody's name gets used to apply pressure by a machine.
--
-- 2. AUTOMATIC NUDGES SHARE THE MANUAL COOLDOWN TABLE.
--    from_member_id becomes nullable, and NULL means automatic. That is not a
--    storage convenience: send_nudge's cooldown check is "newest nudge aimed at
--    this member of this group", so making them one table means an automatic
--    reminder suppresses a manual one and vice versa. Two tables would let
--    somebody be poked twice in a minute by two mechanisms that cannot see
--    each other.
--
-- 3. OFF BY DEFAULT.
--    This is the only thing in the product that messages a person without a
--    person deciding to. It ships disabled and an admin turns it on in the
--    console, the same shape as the receipt-scan kill switch — and for the same
--    reason, that the switch has to be reachable in seconds when it misbehaves.


-- ============================================================
-- NULL sender = automatic.
-- ============================================================
ALTER TABLE "public"."group_nudges" ALTER COLUMN "from_member_id" DROP NOT NULL;

COMMENT ON COLUMN "public"."group_nudges"."from_member_id" IS
  'The member who tapped the button; NULL for an automatic reminder. Shared with the manual cooldown on purpose - see claim_due_nudges.';


-- ============================================================
-- Settings, read on the run path.
-- ============================================================
CREATE OR REPLACE FUNCTION "public"."auto_nudge_settings"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    -- Off unless somebody has deliberately turned it on.
    'enabled', coalesce((s.value ->> 'enabled')::boolean, false),
    -- How long a debt has to have been sitting before it is worth a reminder.
    'overdue_days', greatest(coalesce((s.value ->> 'overdue_days')::int, 14), 1),
    -- And how long before the same person hears about it again.
    'cooldown_days', greatest(coalesce((s.value ->> 'cooldown_days')::int, 7), 1),
    'updated_at', s.updated_at,
    'updated_by_email', s.updated_by_email
  )
  from (select 1) one
  left join app_settings s on s.key = 'auto_nudge';
$$;

ALTER FUNCTION "public"."auto_nudge_settings"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."auto_nudge_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_nudge_settings"() TO "service_role";


CREATE OR REPLACE FUNCTION "public"."admin_console_set_auto_nudge"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_enabled" boolean,
  "p_overdue_days" integer,
  "p_cooldown_days" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_value jsonb;
begin
  v_value := jsonb_build_object(
    'enabled', coalesce(p_enabled, false),
    'overdue_days', greatest(coalesce(p_overdue_days, 14), 1),
    'cooldown_days', greatest(coalesce(p_cooldown_days, 7), 1)
  );

  insert into app_settings (key, value, updated_at, updated_by, updated_by_email)
  values ('auto_nudge', v_value, now(), p_actor, p_actor_email)
  on conflict (key) do update
    set value = v_value, updated_at = now(), updated_by = p_actor, updated_by_email = p_actor_email;

  -- Turning this on or off is exactly the kind of thing somebody will later ask
  -- "who did that, and when" about.
  insert into admin_audit_logs (admin_id, admin_email, action, target_type, target_id, detail)
  values (p_actor, p_actor_email, 'settings.auto_nudge', 'setting', 'auto_nudge', v_value);

  return auto_nudge_settings();
end;
$$;

ALTER FUNCTION "public"."admin_console_set_auto_nudge"("uuid", "text", boolean, integer, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."admin_console_set_auto_nudge"("uuid", "text", boolean, integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_set_auto_nudge"("uuid", "text", boolean, integer, integer) TO "service_role";


-- ============================================================
-- Find who is due, and claim them in the same statement.
-- ============================================================
--
-- "Claim" for the same reason the error alerts do: deciding and recording have
-- to be one operation, or a retried run sends everything twice. The
-- group_nudges rows are written by the same statement that selects the targets,
-- so a second run inside the cooldown returns nothing.
--
-- WHAT "OVERDUE" MEANS. There is no timestamp on a balance, so it is derived:
-- the oldest expense the member shares in that is newer than the last time they
-- settled anything in that group. If that is older than p_overdue_days and they
-- still owe money, the debt has been sitting that long. Reading it out loud:
-- "you have had unsettled expenses since <date> and still owe money".
--
-- Deliberately NOT "balance has been negative for N days" — nothing records
-- that — and deliberately not "N days since you joined", which would nag
-- somebody about an expense from yesterday.
CREATE OR REPLACE FUNCTION "public"."claim_due_nudges"(
  "p_overdue_days" integer,
  "p_cooldown_days" integer,
  "p_limit" integer DEFAULT 50
) RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  with last_settled as (
    -- payer_member_id is text on expenses (a FloatPay-era column type), hence
    -- the cast; a settlement is kind='transfer' paid BY the member.
    select e.group_id, nullif(e.payer_member_id, '')::uuid as member_id, max(e.created_at) as at
    from expenses e
    where e.kind = 'transfer' and e.deleted_at is null
    group by 1, 2
  ),
  owing as (
    select
      b.group_id,
      b.member_id,
      b.balance_minor,
      g.currency,
      g.name as group_name,
      gm.user_id
    from group_member_balances b
    join group_members gm on gm.id = b.member_id
    join groups g on g.id = b.group_id
    where b.balance_minor < 0
      and b.currency = g.currency
      and gm.user_id is not null
      and gm.status = 'active'
      and g.archived_at is null
      and g.deleted_at is null
  ),
  due as (
    select o.*
    from owing o
    where (
      select min(e.expense_date)
      from expense_shares s
      join expenses e on e.id = s.expense_id
      where s.member_id = o.member_id
        and e.group_id = o.group_id
        and e.deleted_at is null
        and e.kind = 'expense'
        and e.created_at > coalesce(
          (select l.at from last_settled l where l.group_id = o.group_id and l.member_id = o.member_id),
          '-infinity'::timestamptz
        )
    ) <= current_date - greatest(coalesce(p_overdue_days, 14), 1)
    -- Any nudge, manual or automatic, inside the window silences this one.
    and not exists (
      select 1 from group_nudges n
      where n.group_id = o.group_id
        and n.to_member_id = o.member_id
        and n.created_at > now() - make_interval(days => greatest(coalesce(p_cooldown_days, 7), 1))
    )
    order by o.balance_minor
    limit greatest(coalesce(p_limit, 50), 1)
  ),
  claimed as (
    insert into group_nudges (group_id, from_member_id, to_member_id)
    select d.group_id, null, d.member_id from due d
    returning group_id, to_member_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'group_id', d.group_id,
    'group_name', d.group_name,
    'member_id', d.member_id,
    'user_id', d.user_id,
    'balance_minor', d.balance_minor,
    'currency', d.currency
  )), '[]'::jsonb)
  from due d
  join claimed c on c.group_id = d.group_id and c.to_member_id = d.member_id;
$$;

ALTER FUNCTION "public"."claim_due_nudges"(integer, integer, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."claim_due_nudges"(integer, integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_due_nudges"(integer, integer, integer) TO "service_role";
