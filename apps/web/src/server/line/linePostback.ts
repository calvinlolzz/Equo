/**
 * The data a LINE postback action carries, and the one place that builds and
 * reads it. LINE hands `data` back to the webhook untouched when the button is
 * tapped, but it comes from the user's device by then and is not trusted: it
 * is parsed against a closed grammar, and an entry key in it is only ever a
 * lookup key inside the SENDER's own ledger - never a proof of ownership.
 *
 * Grammar, all keys in this order, nothing else:
 *   delete_ask      v=1&a=del&k=<entry key>   (the record card's 刪除: only asks)
 *   delete_confirm  v=1&a=delok&k=<entry key> (quick reply: really deletes)
 *   delete_cancel   v=1&a=delno
 *
 * LINE caps `data` at 300 UTF-16 units; the longest string here is
 * "v=1&a=delok&k=" plus an 80-character key whose every character is
 * percent-encoded (":" -> "%3A"), 254 units.
 */

export type LinePostback =
  | { action: "delete_ask"; entryKey: string }
  | { action: "delete_confirm"; entryKey: string }
  | { action: "delete_cancel" };

/** LINE's own limit on a postback action's `data`. */
export const LINE_POSTBACK_DATA_MAX = 300;

/**
 * An entry key: the LINE event key a record was made under. The same pattern
 * as line_record_entry / line_entry_lookup in
 * 20261101090100_line_entry_actions.sql, and as the web app's
 * LINE_ENTRY_KEY_PATTERN in app/lineIntent.ts. Duplicated, not imported: server
 * code must not import app/ modules that lack ".js" import extensions (see
 * scripts/check-api-esm-imports.py). linePostback.test.ts pins this copy to the
 * SQL and to the app copy; server/routes/lineRoutes.ts imports it from here.
 */
export const LINE_ENTRY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,80}$/;

const ACTION_CODE = {
  delete_ask: "del",
  delete_confirm: "delok",
  delete_cancel: "delno",
} as const satisfies Record<LinePostback["action"], string>;

const ACTION_BY_CODE = new Map<string, LinePostback["action"]>(
  (Object.entries(ACTION_CODE) as Array<[LinePostback["action"], string]>).map(([action, code]) => [code, action]),
);

/** The postback data for an action. Throws on an entry key that could never resolve, so a bad key fails at build time rather than as a dead button. */
export function encodeLinePostback(postback: LinePostback): string {
  const code = ACTION_CODE[postback.action];
  if (postback.action === "delete_cancel") return `v=1&a=${code}`;

  if (!LINE_ENTRY_KEY_PATTERN.test(postback.entryKey)) throw new Error("postback entry key is not a valid entry key");
  const data = `v=1&a=${code}&k=${encodeURIComponent(postback.entryKey)}`;
  if (data.length > LINE_POSTBACK_DATA_MAX) throw new Error("postback data is longer than LINE allows");
  return data;
}

/**
 * The action in `data`, or null for anything this module did not write: not a
 * string, longer than LINE allows, an unknown version or action, a missing,
 * extra, repeated or reordered parameter, a key outside the entry-key pattern.
 *
 * Strict by round trip: the parsed value is encoded again and must equal the
 * input, so every spelling other than the canonical one (a trailing "&",
 * lower-case percent escapes, "+" for a space, ...) is refused too.
 */
export function parseLinePostback(data: unknown): LinePostback | null {
  if (typeof data !== "string" || data.length === 0 || data.length > LINE_POSTBACK_DATA_MAX) return null;

  const parts = data.split("&");
  if (parts.length < 2 || parts.length > 3) return null;

  const pairs = parts.map((part) => {
    const at = part.indexOf("=");
    return at < 0 ? null : ([part.slice(0, at), part.slice(at + 1)] as const);
  });
  if (pairs.some((pair) => pair === null)) return null;
  const [version, code, key] = pairs as Array<readonly [string, string]>;

  if (version[0] !== "v" || version[1] !== "1") return null;
  if (code[0] !== "a") return null;
  const action = ACTION_BY_CODE.get(code[1]);
  if (!action) return null;

  let parsed: LinePostback;
  if (action === "delete_cancel") {
    if (key !== undefined) return null;
    parsed = { action };
  } else {
    if (key === undefined || key[0] !== "k") return null;
    let entryKey: string;
    try {
      entryKey = decodeURIComponent(key[1]);
    } catch {
      return null;
    }
    if (!LINE_ENTRY_KEY_PATTERN.test(entryKey)) return null;
    parsed = { action, entryKey };
  }

  return encodeLinePostback(parsed) === data ? parsed : null;
}
