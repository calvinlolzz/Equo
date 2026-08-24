-- 收款資訊: how to actually pay a member back.
--
-- The app can already work out who owes whom and offers a 已結清 button, but it
-- never said where the money should go. Every real settlement therefore left
-- the app — "轉哪個帳號?" in a chat, a screenshot of a bank app, a photo of a
-- QR code — and came back only as somebody tapping 已結清. That gap is the most
-- common complaint about split-the-bill apps, and it is one text field.
--
-- Free text on purpose. Taiwan settles over bank transfers (a code plus the
-- last five digits), LINE Pay, 街口, and increasingly a payment link; a schema
-- with columns per method would be wrong for somebody within a month. What the
-- payer needs is a string they can copy, which is exactly what this is.
--
-- On group_members rather than users, for two reasons:
--   * Virtual members (payer-only rows with no account) receive settlements
--     too. A user-level column could never describe them.
--   * Per-group is the more private default. Sharing your account number with
--     a family group is not the same decision as sharing it with a one-off
--     trip group of near-strangers.
-- The cost is retyping it per group, which is the right trade at this size.
--
-- Never shown outside the group: it rides on get_group_detail, which is already
-- membership-gated, and is not in any admin console payload.


ALTER TABLE "public"."group_members"
  ADD COLUMN IF NOT EXISTS "payment_note" "text";

-- Long enough for "玉山 808 帳號末五碼 12345" or a payment URL, short enough that
-- the column cannot be used as free storage. Enforced here as well as in the
-- request validator, because the validator only guards the one route.
ALTER TABLE "public"."group_members"
  DROP CONSTRAINT IF EXISTS "group_members_payment_note_length";

ALTER TABLE "public"."group_members"
  ADD CONSTRAINT "group_members_payment_note_length"
  CHECK ("payment_note" IS NULL OR "char_length"("payment_note") <= 200);


-- ============================================================
-- Both read paths have to carry it.
-- ============================================================
--
-- Bodies taken from pg_get_functiondef (the live definitions), with the single
-- new key added. get_group_detail is what the app loads a group with;
-- group_member_json is what the member-mutation responses return.

CREATE OR REPLACE FUNCTION "public"."group_member_json"("p_member_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $function$
  select jsonb_build_object(
    'id', m.id,
    'group_id', m.group_id,
    'user_id', m.user_id,
    'display_name', m.display_name,
    'role', m.role,
    'status', m.status,
    'payment_note', m.payment_note
  )
  from group_members m
  where m.id = p_member_id;
$function$;

ALTER FUNCTION "public"."group_member_json"("p_member_id" "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."group_member_json"("p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_member_json"("p_member_id" "uuid") TO "service_role";


-- get_group_detail is 116 lines and this change adds one key to one of its
-- jsonb objects. Reproducing the whole body here to change that line is how a
-- function quietly loses a guard: the 20260725100000 migration text for
-- delete_my_account had already drifted from the live definition by the time
-- anyone looked, and a hand-rewrite from it would have dropped an admin check.
--
-- So this patches the live definition instead of restating it. Deterministic,
-- and it cannot silently do nothing: the anchor is verified to occur exactly
-- once and a miss raises rather than leaving payment_note unexposed.
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_group_detail';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_group_detail is missing; cannot expose payment_note';
  END IF;

  -- Re-runnable: a second application is a no-op rather than a double insert
  -- of the key.
  IF v_def LIKE '%payment_note%' THEN
    RETURN;
  END IF;

  v_new := replace(
    v_def,
    $anchor$'avatar_url', u.avatar_url$anchor$,
    $anchor$'avatar_url', u.avatar_url, 'payment_note', m.payment_note$anchor$
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'get_group_detail: members anchor not found; refusing to leave payment_note unexposed';
  END IF;

  EXECUTE v_new;
END
$do$;
