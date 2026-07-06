/**
 * Near-realtime auto-sync via polling revalidation.
 *
 * True realtime (WebSockets/Supabase Realtime) is off the table here: the
 * app uses a custom session-token auth scheme and RLS is locked down to
 * service-role-only, so subscribing directly from the browser isn't
 * possible. Instead this module polls on a fixed interval and revalidates
 * immediately when the tab regains focus/visibility - "near-realtime"
 * rather than push-based realtime.
 *
 * Safety note: a background refresh landing between a mutation's server
 * response and the local optimistic patch being applied could momentarily
 * show stale data (the refresh overwrites the cache with a snapshot taken
 * before the mutation is reflected server-side, then the mutation's own
 * apply-from-response patch lands on top, then the *next* tick's refresh
 * re-syncs to truth). This is self-healing within one interval tick and is
 * considered an acceptable tradeoff - deliberately NOT building a
 * versioning/vector-clock system to prevent it, since refreshGroupDetail
 * already treats server state as authoritative and every mutation re-applies
 * its own result on top regardless of what a concurrent refresh did.
 */

export type AutoSyncCallbacks = {
  /** Revalidate the currently-open group's detail, if any group is open. */
  refreshActiveGroup: () => Promise<unknown>;
  /** Revalidate the groups list. */
  refreshGroups: () => Promise<unknown>;
};

export type AutoSyncConfig = {
  /** Interval between ticks, in ms. Defaults to 20_000 (20s). */
  intervalMs?: number;
  /** Skip a focus/visibility revalidate if the last sync was more recent than this, in ms. Defaults to 3_000. */
  focusDebounceMs?: number;
  /** Refresh the groups list every Nth tick in addition to the active group. Defaults to 3. */
  groupsListEveryNTicks?: number;
};

export type AutoSyncTimers = {
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
};

export type AutoSyncDocumentLike = {
  visibilityState: "visible" | "hidden" | "prerender" | (string & {});
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

export type AutoSyncWindowLike = {
  addEventListener: (type: "focus", listener: () => void) => void;
  removeEventListener: (type: "focus", listener: () => void) => void;
};

export type CreateAutoSyncOptions = {
  callbacks: AutoSyncCallbacks;
  config?: AutoSyncConfig;
  /** Injectable timers for tests; defaults to window.setInterval/clearInterval. */
  timers?: AutoSyncTimers;
  /** Injectable document for tests; defaults to the global document. */
  doc?: AutoSyncDocumentLike;
  /** Injectable window for tests; defaults to the global window. */
  win?: AutoSyncWindowLike;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
};

const DEFAULT_INTERVAL_MS = 20_000;
const DEFAULT_FOCUS_DEBOUNCE_MS = 3_000;
const DEFAULT_GROUPS_LIST_EVERY_N_TICKS = 3;

/**
 * Manages background revalidation for the cloud store:
 *  - an interval tick every `intervalMs` that refreshes the active group
 *    (and the groups list every Nth tick), but only while the document is
 *    visible;
 *  - a visibilitychange/focus listener that triggers an immediate
 *    revalidate when the tab becomes visible/focused, debounced so a rapid
 *    tab-switch doesn't double-fire (skipped if the last sync was within
 *    `focusDebounceMs`);
 *  - start()/stop() lifecycle - start() is idempotent (calling it twice
 *    without an intervening stop() is a no-op), and stop() tears down both
 *    the interval and the listeners.
 *
 * All failures are swallowed silently (console.debug only) - this is
 * background, best-effort revalidation and must never surface user-facing
 * errors or toast spam.
 */
export function createAutoSync({ callbacks, config, timers, doc, win, now }: CreateAutoSyncOptions) {
  const intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const focusDebounceMs = config?.focusDebounceMs ?? DEFAULT_FOCUS_DEBOUNCE_MS;
  const groupsListEveryNTicks = config?.groupsListEveryNTicks ?? DEFAULT_GROUPS_LIST_EVERY_N_TICKS;

  const timersImpl: AutoSyncTimers =
    timers ??
    (typeof window !== "undefined"
      ? { setInterval: (handler, ms) => window.setInterval(handler, ms), clearInterval: (id) => window.clearInterval(id) }
      : { setInterval: () => 0, clearInterval: () => {} });
  const docImpl: AutoSyncDocumentLike | null = doc ?? (typeof document !== "undefined" ? document : null);
  const winImpl: AutoSyncWindowLike | null = win ?? (typeof window !== "undefined" ? window : null);
  const nowImpl = now ?? (() => Date.now());

  let intervalId: number | null = null;
  let tickCount = 0;
  let lastSyncAt = 0;
  let running = false;

  function isVisible(): boolean {
    return docImpl ? docImpl.visibilityState === "visible" : true;
  }

  function logFailure(context: string, error: unknown) {
    // eslint-disable-next-line no-console
    console.debug(`[autoSync] ${context} failed`, error);
  }

  function revalidate(includeGroupsList: boolean) {
    callbacks.refreshActiveGroup().catch((error) => logFailure("refreshActiveGroup", error));
    if (includeGroupsList) {
      callbacks.refreshGroups().catch((error) => logFailure("refreshGroups", error));
    }
    lastSyncAt = nowImpl();
  }

  function handleTick() {
    if (!isVisible()) return;
    tickCount += 1;
    const includeGroupsList = tickCount % groupsListEveryNTicks === 0;
    revalidate(includeGroupsList);
  }

  function handleFocusOrVisible() {
    if (!isVisible()) return;
    if (nowImpl() - lastSyncAt < focusDebounceMs) return;
    revalidate(true);
  }

  function handleVisibilityChange() {
    if (docImpl?.visibilityState === "visible") {
      handleFocusOrVisible();
    }
  }

  function start() {
    if (running) return;
    running = true;
    tickCount = 0;
    intervalId = timersImpl.setInterval(handleTick, intervalMs);
    docImpl?.addEventListener("visibilitychange", handleVisibilityChange);
    winImpl?.addEventListener("focus", handleFocusOrVisible);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (intervalId !== null) {
      timersImpl.clearInterval(intervalId);
      intervalId = null;
    }
    docImpl?.removeEventListener("visibilitychange", handleVisibilityChange);
    winImpl?.removeEventListener("focus", handleFocusOrVisible);
  }

  return { start, stop };
}

export type AutoSync = ReturnType<typeof createAutoSync>;
