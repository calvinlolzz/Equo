/**
 * What a LIFF session may call.
 *
 * An ALLOWLIST, not a denylist: a route nobody remembered to think about is
 * refused by default. Every pattern is anchored at both ends and built from
 * restricted character classes, so a path that merely CONTAINS an allowed one
 * (`/api/v1/groups/L/../x`, `/api/v1/groups/L/expenses/x/y`, an encoded slash)
 * matches nothing. `ledgerId` is the one personal ledger the token was minted
 * for and is compared byte for byte - it is escaped into the pattern, never
 * matched as a prefix.
 *
 * The question this answers is "may a LIFF token make this request", asked
 * twice and independently: once in front of the router (http/liffGate.ts, which
 * also revokes) and once by the verifier a route calls to learn who the caller
 * is. Unknown method, unknown path, malformed ledger id: all false.
 *
 * `path` is the URL pathname WITHOUT the query string. The runtime receives
 * `new URL(request.url).pathname`, so dot segments are already resolved and %2F
 * is still encoded - and the character classes below reject both `.` and `%`
 * wherever an id goes, so neither can smuggle a different route through.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path segment holding an id: letters, digits, `_` and `-`. No dot, no percent, no slash. */
const ID = "[A-Za-z0-9_-]{1,64}";

/**
 * A LINE entry key (LINE_ENTRY_KEY_PATTERN: 8-80 of [A-Za-z0-9:_-]). The client
 * sends it through encodeURIComponent, so the colon arrives as %3A; that exact
 * escape is the only percent sequence accepted.
 */
const ENTRY_KEY = "(?:[A-Za-z0-9_:-]|%3[Aa]){8,80}";

const API = "/api/v1";

/** Requests that name no ledger. */
const FIXED: ReadonlyArray<readonly [method: string, pattern: RegExp]> = [
  ["GET", new RegExp(`^${API}/site-notice$`)],
  ["GET", new RegExp(`^${API}/catalog$`)],
  ["GET", new RegExp(`^${API}/exchange-rates$`)],
  ["GET", new RegExp(`^${API}/line/liff$`)],
  // The list itself is filtered down to the one ledger by the runtime.
  ["GET", new RegExp(`^${API}/groups$`)],
  ["GET", new RegExp(`^${API}/me/line/entries/${ENTRY_KEY}$`)],
  ["POST", new RegExp(`^${API}/errors$`)],
];

/** Requests under the token's own ledger; `{L}` is replaced by the escaped ledger id. */
const PER_LEDGER: ReadonlyArray<readonly [method: string, template: string]> = [
  ["GET", `^${API}/groups/{L}$`],
  ["GET", `^${API}/groups/{L}/expenses$`],
  ["GET", `^${API}/groups/{L}/expenses/search$`],
  ["GET", `^${API}/groups/{L}/spend-breakdown$`],
  ["GET", `^${API}/groups/{L}/recurring$`],
  ["GET", `^${API}/groups/{L}/expenses/${ID}/comments$`],
  ["POST", `^${API}/groups/{L}/expenses$`],
  ["POST", `^${API}/groups/{L}/images$`],
  ["POST", `^${API}/groups/{L}/read$`],
  ["PUT", `^${API}/groups/{L}/expenses/${ID}$`],
  ["DELETE", `^${API}/groups/{L}/expenses/${ID}$`],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function liffAllows(method: string, path: string, ledgerId: string): boolean {
  if (typeof method !== "string" || typeof path !== "string" || typeof ledgerId !== "string") return false;
  // Without a well-formed ledger id there is nothing to scope to; refuse everything, fixed routes included.
  if (!UUID_PATTERN.test(ledgerId)) return false;

  for (const [allowedMethod, pattern] of FIXED) {
    if (allowedMethod === method && pattern.test(path)) return true;
  }

  const ledger = escapeRegExp(ledgerId);

  for (const [allowedMethod, template] of PER_LEDGER) {
    if (allowedMethod === method && new RegExp(template.replace("{L}", ledger)).test(path)) return true;
  }

  return false;
}
