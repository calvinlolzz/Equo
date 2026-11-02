import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { LOCALES, type Locale } from "../../app/i18n/locale.js";
import { createLinkNonce, sha256Hex } from "../line/lineCrypto.js";
import { LINE_ENTRY_KEY_PATTERN } from "../line/linePostback.js";
import {
  attachLinkRequest,
  getLineLinkForUser,
  resolveLineEntryForUser,
  unlinkLineForUser,
} from "../line/lineRepository.js";

/**
 * The /api/v1/me/line routes: check link status, start a link (from
 * /line/link), unlink (from the profile page), and resolve an entry key from a
 * bot card's link (/me/line/entries/:key). Session-authenticated,
 * same RouteOptions/buildAuthContext pattern as accountRoutes.ts.
 *
 * Nothing here talks to LINE's API - issuing the linkToken itself is the
 * chat bot's job (server/line/lineWebhook.ts's issueLink), triggered by a
 * follow event or a "綁定" message. These routes only handle the browser
 * side of the account-link flow once a token already exists.
 */

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

const LINK_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,256}$/;

function malformedRequest(message: string) {
  return {
    ok: false as const,
    status: 400,
    body: { issues: [{ code: "MALFORMED_REQUEST" as const, message }] },
  };
}

function lineLinkExpired() {
  return {
    ok: false as const,
    status: 410,
    body: {
      error: {
        code: "LINE_LINK_EXPIRED" as const,
        message: "This link has expired. Go back to LINE and send 「綁定」 for a new one.",
        request_id: "req_line_link",
      },
    },
  };
}

/** GET /api/v1/me/line - whether the caller has a LINE account linked, and since when. */
export async function getMyLineLinkRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);
  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  const link = await getLineLinkForUser(options.client, auth.context.user.id);

  return {
    ok: true as const,
    status: 200,
    body: { linked: link !== null, linked_at: link?.linked_at ?? null },
  };
}

/** POST /api/v1/me/line/link {link_token, locale} - attaches this signed-in user to a pending LINE link request and returns LINE's own accountLink dialog URL. */
export async function startLineLinkRoute(
  options: RouteOptions,
  body: { link_token?: unknown; locale?: unknown },
) {
  const linkToken = body?.link_token;
  if (typeof linkToken !== "string" || !LINK_TOKEN_PATTERN.test(linkToken)) {
    return malformedRequest("link_token is required and must be a valid LINE link token.");
  }

  const locale: Locale = (LOCALES as readonly string[]).includes(body?.locale as string)
    ? (body!.locale as Locale)
    : "zh-Hant";

  const auth = await buildAuthContext(options);
  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  const nonce = createLinkNonce();
  const result = await attachLinkRequest(
    options.client,
    sha256Hex(linkToken),
    auth.context.user.id,
    sha256Hex(nonce),
    locale,
  );

  if (result.ok === false) {
    return lineLinkExpired();
  }

  if (result.already_linked) {
    return { ok: true as const, status: 200, body: { already_linked: true } };
  }

  return {
    ok: true as const,
    status: 200,
    body: {
      redirect_url:
        `https://access.line.me/dialog/bot/accountLink?linkToken=${encodeURIComponent(linkToken)}` +
        `&nonce=${encodeURIComponent(nonce)}`,
      currently_linked: result.currently_linked ?? false,
    },
  };
}

/** DELETE /api/v1/me/line - unlinks the caller's own LINE account. Never takes an id from the request. */
export async function unlinkMyLineRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);
  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  const result = await unlinkLineForUser(options.client, auth.context.user.id);

  return { ok: true as const, status: 200, body: { ok: true, unlinked: result.unlinked } };
}

/**
 * GET /api/v1/me/line/entries/:key - where the entry behind a bot card's 編輯
 * link lives now: `live` (with the row and ledger to open, edits followed),
 * `gone` (deleted) or `not_found`. A read, so maintenance does not block it.
 *
 * The key is looked up only in the SESSION user's own personal ledger. Nothing
 * from the request names a user or a group, so a link carrying somebody
 * else's key can only ever answer not_found.
 */
export async function getMyLineEntryRoute(options: RouteOptions, rawKey: string) {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return malformedRequest("entry key is not valid.");
  }
  if (!LINE_ENTRY_KEY_PATTERN.test(key)) {
    return malformedRequest("entry key is not valid.");
  }

  const auth = await buildAuthContext(options);
  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  const resolution = await resolveLineEntryForUser(options.client, auth.context.user.id, key);

  return { ok: true as const, status: 200, body: resolution };
}
