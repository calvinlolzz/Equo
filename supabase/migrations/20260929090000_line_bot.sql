-- LINE bot v1: account link, bot entries and ledger-only record RPCs.
--
-- Purpose: let a user link a LINE account to their Equo account and record
-- expenses/income into their PERSONAL LEDGER by chatting with a bot. Nothing
-- here ever takes a group id from the caller - line_record_entry resolves the
-- ledger itself, through ensure_personal_ledger, so there is no path from a
-- LINE message to a shared group.
--
-- service_role only, same posture as every other table in this schema: RLS on,
-- anon/authenticated explicitly revoked, every function SECURITY DEFINER with
-- a pinned search_path.
--
-- delete_my_account is untouched. All three tables below are
-- ON DELETE CASCADE from public.users (line_bot_entries also cascades from
-- public.groups and public.expenses), so deleting the account already takes
-- every LINE row with it - see the read-first gate this migration's PR
-- description records against the live delete_my_account.
--
-- Only hashes are ever stored - link_token_hash, nonce_hash - never a raw
-- linkToken or nonce. line_user_id is LINE's own opaque per-provider id, not a
-- secret, so it is stored as-is (needed as a lookup key on every message).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."line_accounts" (
  "line_user_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "locale" text NOT NULL DEFAULT 'zh-Hant',
  "linked_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  CONSTRAINT "line_accounts_pkey" PRIMARY KEY ("line_user_id"),
  CONSTRAINT "line_accounts_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "line_accounts_line_user_id_check" CHECK ("line_user_id" ~ '^U[0-9a-f]{32}$'),
  CONSTRAINT "line_accounts_locale_check" CHECK ("locale" IN ('zh-Hant','en')),
  CONSTRAINT "line_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "public"."line_link_requests" (
  "link_token_hash" text NOT NULL,
  "line_user_id" text NOT NULL,
  "user_id" uuid,
  "nonce_hash" text,
  "locale" text NOT NULL DEFAULT 'zh-Hant',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "attached_at" timestamptz,
  "consumed_at" timestamptz,
  CONSTRAINT "line_link_requests_pkey" PRIMARY KEY ("link_token_hash"),
  CONSTRAINT "line_link_requests_nonce_hash_key" UNIQUE ("nonce_hash"),
  CONSTRAINT "line_link_requests_token_hash_check" CHECK ("link_token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "line_link_requests_nonce_hash_check" CHECK ("nonce_hash" IS NULL OR "nonce_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "line_link_requests_line_user_id_check" CHECK ("line_user_id" ~ '^U[0-9a-f]{32}$'),
  CONSTRAINT "line_link_requests_locale_check" CHECK ("locale" IN ('zh-Hant','en')),
  CONSTRAINT "line_link_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "line_link_requests_expires_at_idx" ON "public"."line_link_requests" ("expires_at");
CREATE INDEX IF NOT EXISTS "line_link_requests_user_id_idx" ON "public"."line_link_requests" ("user_id") WHERE "user_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "line_link_requests_line_user_id_idx" ON "public"."line_link_requests" ("line_user_id");

CREATE TABLE IF NOT EXISTS "public"."line_bot_entries" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "webhook_event_id" text NOT NULL,
  "line_user_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "expense_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "undone_at" timestamptz,
  "undone_by_event_id" text,
  CONSTRAINT "line_bot_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "line_bot_entries_event_key" UNIQUE ("webhook_event_id"),
  CONSTRAINT "line_bot_entries_undone_event_key" UNIQUE ("undone_by_event_id"),
  CONSTRAINT "line_bot_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "line_bot_entries_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE,
  CONSTRAINT "line_bot_entries_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "line_bot_entries_undo_idx" ON "public"."line_bot_entries" ("line_user_id", "created_at" DESC) WHERE "undone_at" IS NULL;
CREATE INDEX IF NOT EXISTS "line_bot_entries_user_id_idx" ON "public"."line_bot_entries" ("user_id");
CREATE INDEX IF NOT EXISTS "line_bot_entries_group_id_idx" ON "public"."line_bot_entries" ("group_id");
CREATE INDEX IF NOT EXISTS "line_bot_entries_expense_id_idx" ON "public"."line_bot_entries" ("expense_id");
CREATE INDEX IF NOT EXISTS "line_bot_entries_created_at_idx" ON "public"."line_bot_entries" ("created_at");

-- Every outcome of an undo attempt, not just successful ones - keyed on the
-- webhook event id so a REDELIVERED "復原" can never re-run the undo logic
-- from scratch. Without this, a redelivered event that first found "nothing
-- to undo" (or "already gone") would, on redelivery, look at whatever is
-- newest AT THAT LATER MOMENT - which could by then be a real entry the user
-- recorded in between - and delete it by mistake. Deliberately no foreign key
-- (cascade-free): this is a short-lived idempotency log, not history tied to
-- the account's lifetime, and it is purged on its own schedule alongside
-- line_bot_entries (see purge_line_undo_events below).
CREATE TABLE IF NOT EXISTS "public"."line_undo_events" (
  "webhook_event_id" text NOT NULL,
  "line_user_id" text NOT NULL,
  "result" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "line_undo_events_pkey" PRIMARY KEY ("webhook_event_id"),
  CONSTRAINT "line_undo_events_result_check" CHECK ("result" IN ('not_linked', 'nothing_to_undo', 'already_gone', 'ok'))
);
CREATE INDEX IF NOT EXISTS "line_undo_events_created_at_idx" ON "public"."line_undo_events" ("created_at");

ALTER TABLE "public"."line_accounts" OWNER TO "postgres";
ALTER TABLE "public"."line_accounts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."line_accounts" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."line_accounts" FROM "anon";
REVOKE ALL ON TABLE "public"."line_accounts" FROM "authenticated";
GRANT ALL ON TABLE "public"."line_accounts" TO "service_role";

ALTER TABLE "public"."line_link_requests" OWNER TO "postgres";
ALTER TABLE "public"."line_link_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."line_link_requests" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."line_link_requests" FROM "anon";
REVOKE ALL ON TABLE "public"."line_link_requests" FROM "authenticated";
GRANT ALL ON TABLE "public"."line_link_requests" TO "service_role";

ALTER TABLE "public"."line_bot_entries" OWNER TO "postgres";
ALTER TABLE "public"."line_bot_entries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."line_bot_entries" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."line_bot_entries" FROM "anon";
REVOKE ALL ON TABLE "public"."line_bot_entries" FROM "authenticated";
GRANT ALL ON TABLE "public"."line_bot_entries" TO "service_role";

ALTER TABLE "public"."line_undo_events" OWNER TO "postgres";
ALTER TABLE "public"."line_undo_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."line_undo_events" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."line_undo_events" FROM "anon";
REVOKE ALL ON TABLE "public"."line_undo_events" FROM "authenticated";
GRANT ALL ON TABLE "public"."line_undo_events" TO "service_role";

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- 1. Record that a linkToken was issued to this LINE user, so consuming its
-- nonce later can require a match (defeats nonce theft - see §2 of the plan).
CREATE OR REPLACE FUNCTION "public"."line_register_link_token"(
  "p_link_token_hash" text,
  "p_line_user_id" text,
  "p_ttl_seconds" integer DEFAULT 600
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into line_link_requests (link_token_hash, line_user_id, expires_at)
  values (
    p_link_token_hash,
    p_line_user_id,
    now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 600), 60), 600))
  )
  on conflict (link_token_hash) do nothing;

  return jsonb_build_object('ok', true);
end
$$;

ALTER FUNCTION "public"."line_register_link_token"(text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_register_link_token"(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_register_link_token"(text, text, integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_register_link_token"(text, text, integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_register_link_token"(text, text, integer) TO "service_role";

-- 2. The browser side, once a signed-in user taps "link": attach their Equo
-- user id and a fresh nonce to the pending request. Re-attaching (a second
-- tap, or a retry) overwrites the nonce, so an older nonce for this request
-- stops working.
CREATE OR REPLACE FUNCTION "public"."line_attach_link_request"(
  "p_link_token_hash" text,
  "p_user" uuid,
  "p_nonce_hash" text,
  "p_locale" text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r line_link_requests%rowtype;
  v_locale text := case when p_locale in ('zh-Hant', 'en') then p_locale else 'zh-Hant' end;
begin
  select * into r from line_link_requests where link_token_hash = p_link_token_hash for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if r.consumed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;

  if r.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if exists (select 1 from line_accounts where line_user_id = r.line_user_id and user_id = p_user) then
    return jsonb_build_object('ok', true, 'already_linked', true);
  end if;

  -- Somebody else already attached to this same link request (a race between
  -- two tabs/people, or a stale token reused after it was claimed). The same
  -- user re-tapping still works above, via the already_linked check - this
  -- only rejects a DIFFERENT user_id.
  if r.user_id is not null and r.user_id <> p_user then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;

  update line_link_requests
  set user_id = p_user,
      nonce_hash = p_nonce_hash,
      locale = v_locale,
      attached_at = now()
  where link_token_hash = p_link_token_hash;

  return jsonb_build_object(
    'ok', true,
    'already_linked', false,
    'currently_linked', exists (select 1 from line_accounts where user_id = p_user)
  );
end
$$;

ALTER FUNCTION "public"."line_attach_link_request"(text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_attach_link_request"(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_attach_link_request"(text, uuid, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_attach_link_request"(text, uuid, text, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_attach_link_request"(text, uuid, text, text) TO "service_role";

-- 3. The LINE side: the accountLink event's nonce, consumed under
-- pg_advisory_xact_lock so two concurrent accountLink deliveries for the same
-- Equo user cannot both slip past the "one LINE per Equo account" swap below.
-- One LINE id per Equo account, one Equo account per LINE id - re-linking
-- silently displaces whichever side already had a pair.
CREATE OR REPLACE FUNCTION "public"."line_consume_link_nonce"(
  "p_nonce_hash" text,
  "p_line_user_id" text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r line_link_requests%rowtype;
  u users%rowtype;
  v_prev text;
begin
  select * into r from line_link_requests where nonce_hash = p_nonce_hash for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if r.line_user_id <> p_line_user_id then
    return jsonb_build_object('ok', false, 'reason', 'user_mismatch');
  end if;

  if r.consumed_at is not null then
    if exists (select 1 from line_accounts where line_user_id = p_line_user_id and user_id = r.user_id) then
      return jsonb_build_object(
        'ok', true, 'replay', true,
        'email', (select email from users where id = r.user_id),
        'locale', r.locale
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;

  if r.expires_at + interval '5 minutes' <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into u from users where id = r.user_id;

  if u.id is null or u.deleted_at is not null then
    update line_link_requests set consumed_at = now() where nonce_hash = p_nonce_hash;
    return jsonb_build_object('ok', false, 'reason', 'account_disabled');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('line_link:' || r.user_id::text, 0));

  update line_link_requests set consumed_at = now() where nonce_hash = p_nonce_hash;

  select line_user_id into v_prev from line_accounts where user_id = r.user_id;

  delete from line_accounts where user_id = r.user_id or line_user_id = p_line_user_id;

  insert into line_accounts (line_user_id, user_id, locale) values (p_line_user_id, r.user_id, r.locale);

  return jsonb_build_object(
    'ok', true,
    'replay', false,
    'email', u.email,
    'locale', r.locale,
    'replaced', v_prev is not null and v_prev <> p_line_user_id
  );
end
$$;

ALTER FUNCTION "public"."line_consume_link_nonce"(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_consume_link_nonce"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_consume_link_nonce"(text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_consume_link_nonce"(text, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_consume_link_nonce"(text, text) TO "service_role";

-- 4. "解除綁定" from chat.
CREATE OR REPLACE FUNCTION "public"."line_unlink"("p_line_user_id" text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  delete from line_accounts where line_user_id = p_line_user_id;
  get diagnostics v_count = row_count;

  delete from line_bot_entries where line_user_id = p_line_user_id;
  delete from line_link_requests where line_user_id = p_line_user_id;

  return jsonb_build_object('ok', true, 'unlinked', v_count > 0);
end
$$;

ALTER FUNCTION "public"."line_unlink"(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_unlink"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_unlink"(text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_unlink"(text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_unlink"(text) TO "service_role";

-- 5. DELETE /api/v1/me/line from the profile page - the same unlink, from the
-- Equo side, scoped to the authenticated caller's own id (never an id taken
-- from the request - see lineRoutes.ts).
CREATE OR REPLACE FUNCTION "public"."line_unlink_user"("p_user" uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_line text;
begin
  delete from line_accounts where user_id = p_user returning line_user_id into v_line;

  if v_line is not null then
    delete from line_bot_entries where line_user_id = v_line;
    delete from line_link_requests where line_user_id = v_line;
  end if;

  delete from line_link_requests where user_id = p_user;

  return jsonb_build_object('ok', true, 'unlinked', v_line is not null);
end
$$;

ALTER FUNCTION "public"."line_unlink_user"(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_unlink_user"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_unlink_user"(uuid) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_unlink_user"(uuid) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_unlink_user"(uuid) TO "service_role";

-- 6. What the bot needs to answer a message: who this LINE id belongs to, in
-- what language, whether the account is disabled, its ledger, and the catalog
-- for category matching.
CREATE OR REPLACE FUNCTION "public"."line_context"("p_line_user_id" text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_email text;
  v_locale text;
  v_deleted_at timestamptz;
  v_ledger jsonb;
begin
  select u.id, u.email, la.locale, u.deleted_at
    into v_user, v_email, v_locale, v_deleted_at
  from line_accounts la
  join users u on u.id = la.user_id
  where la.line_user_id = p_line_user_id;

  if v_user is null then
    return null;
  end if;

  if v_deleted_at is not null then
    return jsonb_build_object(
      'user_id', v_user, 'email', v_email, 'locale', v_locale,
      'disabled', true, 'ledger', null, 'categories', '[]'::jsonb
    );
  end if;

  v_ledger := ensure_personal_ledger(v_user);

  return jsonb_build_object(
    'user_id', v_user,
    'email', v_email,
    'locale', v_locale,
    'disabled', false,
    'ledger', v_ledger,
    'categories', coalesce(app_catalog() -> 'categories', '[]'::jsonb)
  );
end
$$;

ALTER FUNCTION "public"."line_context"(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_context"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_context"(text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_context"(text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_context"(text) TO "service_role";

-- 7. This month's spend/income for a ledger, in one currency. A plain SQL
-- STABLE helper - no writes, no locking needed - shared by line_record_entry's
-- reply and line_month_summary.
CREATE OR REPLACE FUNCTION "public"."line_ledger_month_totals"(
  "p_group" uuid,
  "p_currency" text,
  "p_month_start" date
) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'expense_minor', coalesce(sum(e.amount_minor) filter (where e.kind = 'expense'), 0),
    'income_minor', coalesce(sum(e.amount_minor) filter (where e.kind = 'income'), 0))
  from expenses e
  where e.group_id = p_group and e.deleted_at is null and e.currency = p_currency
    and e.expense_date >= date_trunc('month', p_month_start)::date
    and e.expense_date < (date_trunc('month', p_month_start) + interval '1 month')::date;
$$;

ALTER FUNCTION "public"."line_ledger_month_totals"(uuid, text, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_ledger_month_totals"(uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_ledger_month_totals"(uuid, text, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_ledger_month_totals"(uuid, text, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_ledger_month_totals"(uuid, text, date) TO "service_role";

-- 8. Record a chat message as an expense/income. There is NO group parameter,
-- by design: the ledger comes only from ensure_personal_ledger, which is the
-- ledger-only invariant this whole feature rests on - a compromised or buggy
-- caller cannot point this at a shared group no matter what it passes in.
CREATE OR REPLACE FUNCTION "public"."line_record_entry"(
  "p_line_user_id" text,
  "p_event_id" text,
  "p_title" text,
  "p_kind" text,
  "p_category" text,
  "p_amount_minor" integer,
  "p_expense_date" date,
  "p_month_start" date
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_ledger jsonb;
  v_group uuid;
  v_member uuid;
  v_currency text;
  v_replay boolean;
  v_expense jsonb;
begin
  if not (
    p_kind in ('expense', 'income')
    and p_amount_minor > 0 and p_amount_minor <= 1000000000
    and btrim(coalesce(p_title, '')) <> '' and char_length(p_title) <= 60
    and p_event_id ~ '^[A-Za-z0-9:_-]{8,80}$'
    and p_expense_date is not null
  ) then
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

  v_ledger := ensure_personal_ledger(v_user);

  if v_ledger is null then
    return jsonb_build_object('ok', false, 'reason', 'no_ledger');
  end if;

  v_group := (v_ledger ->> 'id')::uuid;
  v_member := (v_ledger ->> 'owner_member_id')::uuid;
  v_currency := v_ledger ->> 'currency';

  v_replay := exists (select 1 from line_bot_entries where webhook_event_id = p_event_id);

  v_expense := create_expense(v_group, v_user, jsonb_build_object(
    'client_request_id', 'line:' || p_event_id,
    'title', btrim(p_title),
    'kind', p_kind,
    'category', p_category,
    'amount_minor', p_amount_minor,
    'currency', v_currency,
    'expense_date', p_expense_date,
    'expense_payments', jsonb_build_array(jsonb_build_object(
      'payer_member_id', v_member,
      'amount_minor', p_amount_minor,
      'currency', v_currency
    )),
    'expense_shares', jsonb_build_array(jsonb_build_object(
      'member_id', v_member,
      'share_type', 'equal',
      'amount_minor', p_amount_minor
    ))
  ));

  insert into line_bot_entries (webhook_event_id, line_user_id, user_id, group_id, expense_id)
  values (p_event_id, p_line_user_id, v_user, v_group, (v_expense ->> 'id')::uuid)
  on conflict (webhook_event_id) do nothing;

  update line_accounts set last_used_at = now() where line_user_id = p_line_user_id;

  return jsonb_build_object(
    'ok', true,
    'replay', v_replay,
    'expense', v_expense,
    'ledger_id', v_group,
    'currency', v_currency,
    'budget_minor', v_ledger -> 'monthly_budget_minor',
    'month', line_ledger_month_totals(v_group, v_currency, p_month_start)
  );
end
$$;

ALTER FUNCTION "public"."line_record_entry"(text, text, text, text, text, integer, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_record_entry"(text, text, text, text, text, integer, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_record_entry"(text, text, text, text, text, integer, date, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_record_entry"(text, text, text, text, text, integer, date, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_record_entry"(text, text, text, text, text, integer, date, date) TO "service_role";

-- 9. "復原" - delete the newest entry this bot created for the linked pair,
-- within a rolling window. Stops at the newest candidate if it has already
-- been edited or deleted in the app (does not fall back to an older one),
-- because guessing which earlier entry the user meant is worse than asking
-- them to open the app.
--
-- Every outcome (not just a successful delete) is recorded in
-- line_undo_events, keyed on the webhook event id, and checked FIRST. Without
-- this, a redelivered "復原" whose first attempt found nothing to undo would
-- re-run the whole lookup on redelivery - and by then a genuinely new entry
-- might exist, which it would delete by mistake. Recording every outcome
-- means a redelivery always echoes the original answer instead of doing new
-- work.
CREATE OR REPLACE FUNCTION "public"."line_undo_last"(
  "p_line_user_id" text,
  "p_event_id" text,
  "p_window_minutes" integer DEFAULT 30
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  e line_bot_entries%rowtype;
  v_user uuid;
  v_deleted_at timestamptz;
  v_deleted jsonb;
  v_prior_result text;
begin
  select result into v_prior_result from line_undo_events where webhook_event_id = p_event_id;

  if found then
    if v_prior_result = 'ok' then
      select * into e from line_bot_entries where undone_by_event_id = p_event_id;
      return jsonb_build_object('ok', true, 'replay', true, 'expense', expense_json(e.expense_id));
    end if;
    return jsonb_build_object('ok', false, 'reason', v_prior_result, 'replay', true);
  end if;

  select la.user_id, u.deleted_at into v_user, v_deleted_at
  from line_accounts la
  join users u on u.id = la.user_id
  where la.line_user_id = p_line_user_id;

  if v_user is null then
    insert into line_undo_events (webhook_event_id, line_user_id, result) values (p_event_id, p_line_user_id, 'not_linked');
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  select * into e
  from line_bot_entries
  where line_user_id = p_line_user_id
    and user_id = v_user
    and undone_at is null
    and created_at > now() - make_interval(mins => least(greatest(coalesce(p_window_minutes, 30), 1), 1440))
  order by created_at desc
  limit 1
  for update;

  if not found then
    insert into line_undo_events (webhook_event_id, line_user_id, result) values (p_event_id, p_line_user_id, 'nothing_to_undo');
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_undo');
  end if;

  if exists (select 1 from expenses where id = e.expense_id and deleted_at is not null) then
    insert into line_undo_events (webhook_event_id, line_user_id, result) values (p_event_id, p_line_user_id, 'already_gone');
    return jsonb_build_object('ok', false, 'reason', 'already_gone');
  end if;

  v_deleted := soft_delete_expense(e.group_id, v_user, e.expense_id, 'line:' || p_event_id);

  update line_bot_entries set undone_at = now(), undone_by_event_id = p_event_id where id = e.id;

  insert into line_undo_events (webhook_event_id, line_user_id, result) values (p_event_id, p_line_user_id, 'ok');

  return jsonb_build_object('ok', true, 'replay', false, 'expense', v_deleted);
end
$$;

ALTER FUNCTION "public"."line_undo_last"(text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_undo_last"(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_undo_last"(text, text, integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_undo_last"(text, text, integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_undo_last"(text, text, integer) TO "service_role";

-- 10. "本月" - the month summary reply.
CREATE OR REPLACE FUNCTION "public"."line_month_summary"("p_line_user_id" text, "p_month_start" date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
  v_deleted_at timestamptz;
  v_ledger jsonb;
  v_group uuid;
  v_currency text;
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

  v_ledger := ensure_personal_ledger(v_user);

  if v_ledger is null then
    return jsonb_build_object('ok', false, 'reason', 'no_ledger');
  end if;

  v_group := (v_ledger ->> 'id')::uuid;
  v_currency := v_ledger ->> 'currency';

  return jsonb_build_object(
    'ok', true,
    'ledger_id', v_group,
    'currency', v_currency,
    'budget_minor', v_ledger -> 'monthly_budget_minor',
    'month', line_ledger_month_totals(v_group, v_currency, p_month_start)
  );
end
$$;

ALTER FUNCTION "public"."line_month_summary"(text, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_month_summary"(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_month_summary"(text, date) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_month_summary"(text, date) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_month_summary"(text, date) TO "service_role";

-- 11. Nightly purge: pending link requests. Floor of 1 day, not the usual 30 -
-- these rows are dead credentials 10 minutes after they are issued, not
-- history worth keeping around; anything past its expiry plus a day is chaff.
CREATE OR REPLACE FUNCTION "public"."purge_line_link_requests"("p_days" integer DEFAULT 1) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from line_link_requests where expires_at < now() - make_interval(days => greatest(coalesce(p_days, 1), 1));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end
$$;

ALTER FUNCTION "public"."purge_line_link_requests"(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."purge_line_link_requests"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."purge_line_link_requests"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."purge_line_link_requests"(integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."purge_line_link_requests"(integer) TO "service_role";

-- 12. Nightly purge: old bot entries. Floor of 30 days - these rows only exist
-- to bound the undo window and to keep webhook-event idempotency working for
-- redelivery; the expenses they point at are untouched.
CREATE OR REPLACE FUNCTION "public"."purge_line_bot_entries"("p_days" integer DEFAULT 90) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from line_bot_entries where created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end
$$;

ALTER FUNCTION "public"."purge_line_bot_entries"(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."purge_line_bot_entries"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."purge_line_bot_entries"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."purge_line_bot_entries"(integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."purge_line_bot_entries"(integer) TO "service_role";

-- 13. Nightly purge: undo-attempt outcomes. Same 30-day floor and purpose as
-- purge_line_bot_entries (these rows only exist to make a redelivered undo
-- safe) - purged on the same schedule, from the same nightly step.
CREATE OR REPLACE FUNCTION "public"."purge_line_undo_events"("p_days" integer DEFAULT 90) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from line_undo_events where created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end
$$;

ALTER FUNCTION "public"."purge_line_undo_events"(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."purge_line_undo_events"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."purge_line_undo_events"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."purge_line_undo_events"(integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."purge_line_undo_events"(integer) TO "service_role";
