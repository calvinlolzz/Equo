-- LINE round 2: the record card's 編輯/刪除 and the mood card's streak.
--
-- A card names its entry by the LINE event key it was recorded under:
-- expenses.client_request_id = 'line:'||key is set by line_record_entry and
-- lives on the row for good (unique per ledger via
-- expenses_group_client_request_id_key), unlike line_bot_entries (90 days,
-- cleared on unlink). Edits made in the app are followed through
-- expenses.replaced_by_expense_id (20261101090000_expense_replaced_by.sql).
--
-- Same posture as every line_ function: SECURITY DEFINER, pinned search_path,
-- owned by postgres, revoked from PUBLIC/anon/authenticated, service_role only.
-- Webhook-facing functions take p_line_user_id and never a group id; the one
-- web-facing function (line_entry_resolve) takes p_user, always the session
-- user. A STABLE function never calls ensure_personal_ledger (it writes).
--
-- line_undo_last / line_bot_entries / line_undo_events are NOT touched: a card
-- delete does not set line_bot_entries.undone_at, so 復原 keeps its semantics.

CREATE OR REPLACE FUNCTION "public"."line_personal_ledger_id"("p_user" uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select g.id from groups g
  where g.owner_id = p_user and g.kind = 'personal' and g.deleted_at is null
  limit 1;
$$;

ALTER FUNCTION "public"."line_personal_ledger_id"(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_personal_ledger_id"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_personal_ledger_id"(uuid) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_personal_ledger_id"(uuid) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_personal_ledger_id"(uuid) TO "service_role";

-- One ledger, one entry key -> where that entry lives now. NULL = no such
-- entry in this ledger. Otherwise {expense_id, live, edited}; expense_id is
-- NULL when the chain of app edits dangles (a hard-deleted successor).
CREATE OR REPLACE FUNCTION "public"."line_entry_lookup"("p_group" uuid, "p_entry_key" text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_deleted timestamptz;
  v_next uuid;
  v_hops integer := 0;
begin
  if p_group is null or p_entry_key is null or p_entry_key !~ '^[A-Za-z0-9:_-]{8,80}$' then
    return null;
  end if;

  select e.id, e.deleted_at, e.replaced_by_expense_id into v_id, v_deleted, v_next
  from expenses e
  where e.group_id = p_group and e.client_request_id = 'line:' || p_entry_key;

  if v_id is null then
    return null;
  end if;

  -- Follow app edits. Bounded, and confined to this ledger at every hop.
  while v_deleted is not null and v_next is not null and v_hops < 50 loop
    select e.id, e.deleted_at, e.replaced_by_expense_id into v_id, v_deleted, v_next
    from expenses e
    where e.id = v_next and e.group_id = p_group;

    if v_id is null then
      return jsonb_build_object('expense_id', null, 'live', false, 'edited', true);
    end if;

    v_hops := v_hops + 1;
  end loop;

  return jsonb_build_object('expense_id', v_id, 'live', v_deleted is null, 'edited', v_hops > 0);
end
$$;

ALTER FUNCTION "public"."line_entry_lookup"(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_entry_lookup"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_entry_lookup"(uuid, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_entry_lookup"(uuid, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_entry_lookup"(uuid, text) TO "service_role";

-- Web: GET /api/v1/me/line/entries/:key, for the session user only.
CREATE OR REPLACE FUNCTION "public"."line_entry_resolve"("p_user" uuid, "p_entry_key" text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group uuid;
  v_found jsonb;
  v_id uuid;
begin
  v_group := line_personal_ledger_id(p_user);
  v_found := line_entry_lookup(v_group, p_entry_key);

  if v_found is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not (v_found ->> 'live')::boolean then
    return jsonb_build_object('status', 'gone');
  end if;

  v_id := (v_found ->> 'expense_id')::uuid;

  return jsonb_build_object(
    'status', 'live',
    'group_id', v_group,
    'expense_id', v_id,
    'expense_date', (select e.expense_date from expenses e where e.id = v_id),
    'edited', (v_found ->> 'edited')::boolean
  );
end
$$;

ALTER FUNCTION "public"."line_entry_resolve"(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_entry_resolve"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_entry_resolve"(uuid, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_entry_resolve"(uuid, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_entry_resolve"(uuid, text) TO "service_role";

-- Bot, the ask step (read only): what would 刪除 delete right now?
CREATE OR REPLACE FUNCTION "public"."line_entry_status"("p_line_user_id" text, "p_entry_key" text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_found jsonb;
begin
  select la.user_id, u.deleted_at into v_user, v_deleted_at
  from line_accounts la
  join users u on u.id = la.user_id
  where la.line_user_id = p_line_user_id;

  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  if v_deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_disabled');
  end if;

  v_found := line_entry_lookup(line_personal_ledger_id(v_user), p_entry_key);

  if v_found is null then
    return jsonb_build_object('ok', true, 'status', 'not_found');
  end if;

  if not (v_found ->> 'live')::boolean then
    return jsonb_build_object('ok', true, 'status', 'gone');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'live',
    'edited', (v_found ->> 'edited')::boolean,
    'expense', expense_json((v_found ->> 'expense_id')::uuid)
  );
end
$$;

ALTER FUNCTION "public"."line_entry_status"(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_entry_status"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_entry_status"(text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_entry_status"(text, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_entry_status"(text, text) TO "service_role";

-- Bot, the confirm step. Idempotent per webhook event; serialised per row.
CREATE OR REPLACE FUNCTION "public"."line_delete_entry"("p_line_user_id" text, "p_entry_key" text, "p_event_id" text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_group uuid;
  v_prior uuid;
  v_found jsonb;
  v_target uuid;
  v_target_deleted timestamptz;
  v_deleted jsonb;
begin
  if p_entry_key is null or p_entry_key !~ '^[A-Za-z0-9:_-]{8,80}$'
     or p_event_id is null or p_event_id !~ '^[A-Za-z0-9:_-]{8,80}$' then
    raise exception 'LINE_INVALID_ENTRY';
  end if;

  select la.user_id, u.deleted_at into v_user, v_deleted_at
  from line_accounts la
  join users u on u.id = la.user_id
  where la.line_user_id = p_line_user_id;

  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  if v_deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_disabled');
  end if;

  v_group := line_personal_ledger_id(v_user);

  if v_group is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- A REDELIVERED 確定刪除 answers exactly as the first delivery did. Checked
  -- before resolving, because after the first delivery the entry is gone and a
  -- fresh lookup would say so.
  select cr.resource_id into v_prior
  from client_requests cr
  where cr.group_id = v_group and cr.client_request_id = 'line:' || p_event_id;

  if v_prior is not null then
    return jsonb_build_object('ok', true, 'replay', true, 'expense', expense_json(v_prior));
  end if;

  v_found := line_entry_lookup(v_group, p_entry_key);

  if v_found is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_target := (v_found ->> 'expense_id')::uuid;

  if v_target is null or not (v_found ->> 'live')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'already_gone');
  end if;

  -- Two taps, or the app editing this row right now: wait, then re-read.
  select e.deleted_at into v_target_deleted
  from expenses e
  where e.id = v_target and e.group_id = v_group
  for update;

  if not found or v_target_deleted is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_gone');
  end if;

  v_deleted := soft_delete_expense(v_group, v_user, v_target, 'line:' || p_event_id);

  update line_accounts set last_used_at = now() where line_user_id = p_line_user_id;

  return jsonb_build_object(
    'ok', true,
    'replay', false,
    'edited', (v_found ->> 'edited')::boolean,
    'expense', v_deleted
  );
end
$$;

ALTER FUNCTION "public"."line_delete_entry"(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_delete_entry"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_delete_entry"(text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_delete_entry"(text, text, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_delete_entry"(text, text, text) TO "service_role";

-- Streak and counts, by expense_date (the day the entry is FOR), Taiwan date
-- passed in by the caller, any source (app or LINE), live expense/income only,
-- nothing after p_today. Editing keeps the day; backfilling a missed day in the
-- app repairs the streak (deliberate - see the plan's §2/§9). Looks back 400
-- days for the run (milestones stop at 365); week starts on Monday (ISO).
CREATE OR REPLACE FUNCTION "public"."line_ledger_stats"("p_group" uuid, "p_today" date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with live as (
    select e.expense_date
    from expenses e
    where e.group_id = p_group and e.deleted_at is null
      and e.kind in ('expense', 'income')
      and e.expense_date <= p_today
  ),
  days as (
    select distinct l.expense_date as d from live l where l.expense_date > p_today - 400
  ),
  ranked as (
    select d, row_number() over (order by d desc) as rn from days
  ),
  week as (
    select g.i, date_trunc('week', p_today)::date + g.i as d from generate_series(0, 6) as g(i)
  )
  select jsonb_build_object(
    'streak_days',   (select count(*) from ranked r where r.d = p_today - (r.rn - 1)::integer),
    'week',          (select jsonb_agg(exists (select 1 from days x where x.d = w.d) order by w.i) from week w),
    'today_index',   extract(isodow from p_today)::integer - 1,
    'month_days',    (select count(*) from days x where x.d >= date_trunc('month', p_today)::date),
    'today_entries', (select count(*) from live l where l.expense_date = p_today),
    'total_entries', (select count(*) from live l)
  );
$$;

ALTER FUNCTION "public"."line_ledger_stats"(uuid, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_ledger_stats"(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_ledger_stats"(uuid, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_ledger_stats"(uuid, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_ledger_stats"(uuid, date) TO "service_role";

-- Bot, the mood card: the streak after a record. Read only.
CREATE OR REPLACE FUNCTION "public"."line_streak"("p_line_user_id" text, "p_today" date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_group uuid;
begin
  select la.user_id, u.deleted_at into v_user, v_deleted_at
  from line_accounts la
  join users u on u.id = la.user_id
  where la.line_user_id = p_line_user_id;

  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  if v_deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_disabled');
  end if;

  v_group := line_personal_ledger_id(v_user);

  if v_group is null then
    return jsonb_build_object('ok', false, 'reason', 'no_ledger');
  end if;

  return jsonb_build_object('ok', true, 'stats', line_ledger_stats(v_group, p_today));
end
$$;

ALTER FUNCTION "public"."line_streak"(text, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_streak"(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_streak"(text, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_streak"(text, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_streak"(text, date) TO "service_role";
