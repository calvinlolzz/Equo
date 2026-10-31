/**
 * Links the LINE bot sends: `?view=records`, `?view=analysis` and
 * `?entry=<key>` on the personal ledger's own URL (`/group/<ledger>?...`).
 *
 * Only these three shapes are honoured, and never a URL - a link that says
 * where to go is an open redirect waiting to happen, one that says which of
 * three screens to open is not. Like `?shortcut=` (appShortcuts.ts), the
 * intent has to survive the Google OAuth round trip, which throws the query
 * string away, so it is stashed before the redirect and picked up on the way
 * back.
 */
export type LineIntent = { kind: "records" } | { kind: "analysis" } | { kind: "entry"; entryKey: string };

/**
 * The shape of an entry key: the LINE event id the bot recorded the entry
 * under. Identical to the check in line_record_entry / line_entry_lookup (SQL)
 * and to the copy in server/line/linePostback.ts; a test pins the server copy
 * to this one, because server code cannot import this module (ESM `.js` rule).
 */
export const LINE_ENTRY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,80}$/;

/** What the intent in a URL's query string asks for. `entry` wins over `view`; anything else is ignored. */
export function readLineIntent(search: string): LineIntent | null {
  const params = new URLSearchParams(search);

  const entryKey = params.get("entry") ?? "";
  if (LINE_ENTRY_KEY_PATTERN.test(entryKey)) return { kind: "entry", entryKey };

  const view = params.get("view");
  if (view === "records") return { kind: "records" };
  if (view === "analysis") return { kind: "analysis" };

  return null;
}

/**
 * Strips `view` and `entry` from the address bar once the intent has been
 * consumed, so a reload doesn't reopen it. Keeps every other parameter
 * (`openExternalBrowser`, `invite`, ...) and the history state - the overlay
 * stack's depth lives there.
 */
export function clearLineIntentParams(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("view") && !url.searchParams.has("entry")) return;
  url.searchParams.delete("view");
  url.searchParams.delete("entry");
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
}

const PENDING_LINE_INTENT_KEY = "equo.clean.pending_line_intent";
const PENDING_LINE_INTENT_TTL_MS = 15 * 60 * 1000;

/** Remembers the intent across the OAuth redirect. Never throws: a deep link is a nicety, not a reason to block login. */
export function stashLineIntent(intent: LineIntent, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(PENDING_LINE_INTENT_KEY, JSON.stringify({ intent, at: now }));
  } catch {
    // Storage unavailable (private mode / blocked cookies).
  }
}

/** Throws away a stash that will not be used, so it cannot fire on some later, unrelated sign-in. */
export function clearStashedLineIntent(): void {
  try {
    window.localStorage.removeItem(PENDING_LINE_INTENT_KEY);
  } catch {
    // Nothing to clear if storage is unreachable.
  }
}

/** Re-validates a parsed value: the stash is storage, i.e. input. */
function parseStashedIntent(value: unknown): LineIntent | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { kind?: unknown; entryKey?: unknown };
  if (candidate.kind === "records") return { kind: "records" };
  if (candidate.kind === "analysis") return { kind: "analysis" };
  if (
    candidate.kind === "entry" &&
    typeof candidate.entryKey === "string" &&
    LINE_ENTRY_KEY_PATTERN.test(candidate.entryKey)
  ) {
    return { kind: "entry", entryKey: candidate.entryKey };
  }
  return null;
}

/**
 * The stashed intent, consumed: it is removed whether or not it is still
 * usable. Expired (older than 15 minutes) or malformed content is null.
 */
export function takeStashedLineIntent(now: number = Date.now()): LineIntent | null {
  try {
    const raw = window.localStorage.getItem(PENDING_LINE_INTENT_KEY);
    if (raw === null) return null;
    window.localStorage.removeItem(PENDING_LINE_INTENT_KEY);

    const parsed = JSON.parse(raw) as { intent?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || now - parsed.at > PENDING_LINE_INTENT_TTL_MS) return null;
    return parseStashedIntent(parsed.intent);
  } catch {
    return null;
  }
}
