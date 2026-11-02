-- LINE round 2, Phase B: LIFF login (opening Equo inside LINE).
--
-- The server verifies a LINE ID token through LINE's verify endpoint (channel
-- id only, no secret) and gets back a LINE user id (`sub`) - the same id the
-- webhook sees in source.userId, because the LINE Login channel lives in the
-- provider that owns the Messaging API channel. These two functions turn that
-- id into an Equo identity and keep the resulting token honest afterwards.
--
-- line_liff_identity    the exchange: LINE user id -> user, personal ledger id,
--                       locale. The ONLY way a LIFF token is ever minted.
-- line_liff_link_live   the revocation check, run on every LIFF request: is
--                       this token's user still linked to the LINE account it
--                       was minted for, still enabled, still the owner of the
--                       ledger it names? Unlinking, an admin merge, disabling
--                       or deleting the account each make it false, so a LIFF
--                       token stops working at once instead of at its expiry.
--
-- Same posture as every line_ function: SECURITY DEFINER, pinned search_path,
-- owned by postgres, revoked from PUBLIC/anon/authenticated, service_role only.
-- line_liff_identity takes a LINE user id and nothing that names a user or a
-- group; it is VOLATILE because ensure_personal_ledger may create the ledger
-- (a write), and line_liff_link_live is STABLE and never writes.

-- The exchange. ok:false reasons: not_linked, account_disabled, no_ledger.
CREATE OR REPLACE FUNCTION "public"."line_liff_identity"("p_line_user_id" text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_locale text;
  u users%rowtype;
  v_ledger jsonb;
begin
  if p_line_user_id is null or p_line_user_id !~ '^U[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  select la.user_id, la.locale into v_user_id, v_locale
  from line_accounts la
  where la.line_user_id = p_line_user_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  select * into u from users where id = v_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  -- Checked BEFORE ensure_personal_ledger: a disabled account must not get a
  -- ledger created on its behalf.
  if u.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_disabled');
  end if;

  -- A POST path, so the lazy create is fine here (GET /groups does the same).
  v_ledger := ensure_personal_ledger(u.id);

  if v_ledger is null or v_ledger ->> 'id' is null then
    return jsonb_build_object('ok', false, 'reason', 'no_ledger');
  end if;

  update line_accounts set last_used_at = now() where line_user_id = p_line_user_id;

  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object(
      'id', u.id,
      'google_sub', u.google_sub,
      'email', u.email,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url
    ),
    'ledger_id', v_ledger ->> 'id',
    'locale', v_locale
  );
end
$$;

ALTER FUNCTION "public"."line_liff_identity"(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_liff_identity"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_liff_identity"(text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_liff_identity"(text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_liff_identity"(text) TO "service_role";

-- Revocation. p_line_sub_hash is sha256 hex of the LINE user id, exactly what
-- the token carries (the token never holds the id itself). All of it must still
-- hold: the link maps this user to that LINE account, the user is enabled, and
-- the ledger is that user's own live personal ledger.
CREATE OR REPLACE FUNCTION "public"."line_liff_link_live"("p_user" uuid, "p_ledger" uuid, "p_line_sub_hash" text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from line_accounts la
    join users u on u.id = la.user_id
    join groups g on g.owner_id = la.user_id
    where la.user_id = p_user
      and u.deleted_at is null
      and g.id = p_ledger
      and g.kind = 'personal'
      and g.deleted_at is null
      and encode(sha256(convert_to(la.line_user_id, 'UTF8')), 'hex') = p_line_sub_hash
  );
$$;

ALTER FUNCTION "public"."line_liff_link_live"(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION "public"."line_liff_link_live"(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."line_liff_link_live"(uuid, uuid, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."line_liff_link_live"(uuid, uuid, text) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."line_liff_link_live"(uuid, uuid, text) TO "service_role";
