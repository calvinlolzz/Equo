import type { DialogMode } from "./appTypes";
import type { LineIntent } from "./lineIntent";
import type { StoredSession } from "./sessionStore";

/**
 * Which of the app's surfaces a given way of opening it shows.
 *
 * "full" is the app everybody knows and every flag is on: it is the default,
 * and a test pins it, so the normal app cannot lose something because the
 * LIFF page needed it gone. "liff" is the same <App /> inside LINE, signed in
 * with a LIFF-scoped token that may only touch the personal ledger
 * (server/http/liffScope.ts). Anything the server would refuse with 403
 * LIFF_SCOPE is simply not offered here - a denied request is a client bug,
 * and the allowlist test in App.liff.test.tsx fails on one.
 *
 * Hiding the button is not the whole job: `dialogs` also closes the door in
 * the state setter, so a stray code path (a shortcut, a stashed invite, a
 * future caller) cannot open a sheet this chrome never meant to show.
 */
export type AppChrome = {
  /**
   * The group rail, side nav, both drawers, the 群組/帳本 tab and the menu button: moving between ledgers and groups.
   * Also the 首頁 tab, which is not navigation but is dropped with the rest so the phone bar's three slots centre the ＋.
   */
  groupNavigation: boolean;
  /** The profile dot and dialog (name, photo, language, legal pages, LINE link row, delete account). */
  profile: boolean;
  /** The bell and its inbox, and the polling behind it. */
  notifications: boolean;
  /** "Add to home screen". */
  installHint: boolean;
  /** "Record from LINE" suggestion on the ledger home. */
  lineHint: boolean;
  /** Sending feedback. */
  feedback: boolean;
  /** The receipt-scan button (and the consent ask in front of it). */
  receiptScan: boolean;
  /** The ▾ menu beside the ledger's name: edit, export, archive, delete. */
  groupMenu: boolean;
  /** Signing out. */
  signOut: boolean;
  /** The Google sign-in landing page and everything that feeds it (OAuth fragment, redirect). Google sign-in cannot run inside LINE. */
  landing: boolean;
  /**
   * Reads and writes this browser's saved session, cloud cache and offline
   * queue. Off for LIFF: its session is memory-only, and a LIFF page must
   * neither log the normal app out nor replay its queued writes under a token
   * that is only good for one ledger.
   */
  localSession: boolean;
  /** The sheets `setDialog` will open; null means all of them. */
  dialogs: ReadonlySet<NonNullable<DialogMode>> | null;
};

export type AppChromeMode = "full" | "liff";

const FULL: AppChrome = Object.freeze({
  groupNavigation: true,
  profile: true,
  notifications: true,
  installHint: true,
  lineHint: true,
  feedback: true,
  receiptScan: true,
  groupMenu: true,
  signOut: true,
  landing: true,
  localSession: true,
  dialogs: null,
});

const LIFF: AppChrome = Object.freeze({
  groupNavigation: false,
  profile: false,
  notifications: false,
  installHint: false,
  lineHint: false,
  feedback: false,
  receiptScan: false,
  groupMenu: false,
  signOut: false,
  landing: false,
  localSession: false,
  // 明細 and 分析 are what the card links open; everything else is a group or
  // account surface.
  dialogs: new Set<NonNullable<DialogMode>>(["recordsPanel", "analysisPanel"]),
});

export function resolveAppChrome(mode: AppChromeMode = "full"): AppChrome {
  return mode === "liff" ? LIFF : FULL;
}

/** Closing (null) is always allowed; opening is allowed for the sheets this chrome lists. */
export function dialogAllowed(chrome: AppChrome, mode: DialogMode): boolean {
  if (mode === null || chrome.dialogs === null) return true;
  return chrome.dialogs.has(mode);
}

/**
 * What /liff hands the App once the LINE sign-in has produced a session.
 * Passing it is what puts <App /> in the LIFF chrome.
 */
export type LiffAppContext = {
  session: StoredSession;
  /** The personal ledger the LIFF token is scoped to. */
  ledgerId: string;
  /** What the link asked for (明細 / 分析 / one entry), already validated; null for a plain open. */
  intent: LineIntent | null;
  /**
   * Called when a request comes back 401: get a fresh LIFF session and say
   * whether there is one. False ends the session (LiffApp shows its own
   * screen); the app never falls back to the Google login wall.
   */
  reauthenticate: () => Promise<boolean>;
};
