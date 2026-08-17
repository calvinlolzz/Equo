/**
 * Near-realtime auto-sync via polling revalidation.
 *
 * True realtime (WebSockets/Supabase Realtime) is off the table here: the
 * app uses a custom session-token auth scheme and RLS is locked down to
 * service-role-only, so subscribing directly from the browser isn't
 * possible. Instead this module polls on an interval and revalidates
 * immediately when the tab regains focus/visibility - "near-realtime"
 * rather than push-based realtime.
 *
 * The interval is not fixed. A phone left sitting on a group screen was
 * re-fetching the whole detail payload (up to 100 expenses, plus members,
 * balances and aggregates) every 20 seconds forever - 180 requests an hour,
 * almost all of them byte-identical, each one waking the radio. So the gap
 * backs off the longer the user goes without touching anything, and collapses
 * straight back to the fast rung the moment they do (see BACKOFF_RUNGS and
 * resolvePollIntervalMs). Web push already covers the "something happened
 * while you weren't looking" case, which is what makes idle polling the part
 * that can afford to be lazy.
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
  /** Heartbeat between ticks, in ms - also the fastest possible poll gap. Defaults to 20_000 (20s). */
  intervalMs?: number;
  /** Skip a focus/visibility revalidate if the last sync was more recent than this, in ms. Defaults to 3_000. */
  focusDebounceMs?: number;
  /** Refresh the groups list every Nth sync in addition to the active group. Defaults to 3. */
  groupsListEveryNTicks?: number;
  /** Idle backoff ladder. Defaults to BACKOFF_RUNGS. */
  backoffRungs?: BackoffRung[];
};

/**
 * One step of the idle backoff ladder: once the user has been idle for at
 * least `idleAfterMs`, poll no more often than `intervalMs`.
 */
export type BackoffRung = {
  idleAfterMs: number;
  intervalMs: number;
};

/**
 * Default ladder. Deliberately coarse - the point is to stop burning battery on
 * a screen nobody is looking at, not to model usage precisely.
 *
 *   active (< 1 min idle)   20s   unchanged from before, this is the case where
 *                                 somebody is actually watching for a flatmate's
 *                                 expense to land
 *   reading (1-5 min idle)  60s
 *   parked (> 5 min idle)  180s   a phone left open on the group screen
 *
 * An hour parked drops from 180 requests to 24.
 */
export const BACKOFF_RUNGS: BackoffRung[] = [
  { idleAfterMs: 0, intervalMs: 20_000 },
  { idleAfterMs: 60_000, intervalMs: 60_000 },
  { idleAfterMs: 300_000, intervalMs: 180_000 },
];

/**
 * The minimum gap between polls for a user who has been idle `idleMs`.
 *
 * Extracted and exported for the same reason GlassBackground's shouldAnimate
 * is: this single function is the whole of the battery story, and it is worth
 * testing without a timer, a document, or a network in the way.
 *
 * Rungs are walked in order and the last match wins, so the ladder must be
 * ordered ascending by idleAfterMs. An empty ladder falls back to `fallbackMs`.
 */
export function resolvePollIntervalMs(idleMs: number, rungs: BackoffRung[], fallbackMs: number): number {
  let resolved = fallbackMs;
  for (const rung of rungs) {
    if (idleMs >= rung.idleAfterMs) resolved = rung.intervalMs;
  }
  return resolved;
}

export type AutoSyncTimers = {
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
};

export type AutoSyncDocumentLike = {
  visibilityState: "visible" | "hidden" | "prerender" | (string & {});
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

/**
 * Window events this module listens for: `focus`/`online` to revalidate, and
 * the three interaction events that reset the backoff ladder. Scroll, pointer
 * and key all bubble to the window, so one target covers the lot.
 */
export type AutoSyncWindowEvent = "focus" | "online" | "pointerdown" | "keydown" | "scroll";

export type AutoSyncWindowLike = {
  addEventListener: (type: AutoSyncWindowEvent, listener: () => void, options?: { passive?: boolean }) => void;
  removeEventListener: (type: AutoSyncWindowEvent, listener: () => void) => void;
};

/** Just the online flag - see isOnline. */
export type AutoSyncNavigatorLike = {
  onLine: boolean;
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
  /** Injectable navigator for tests; defaults to the global navigator. */
  nav?: AutoSyncNavigatorLike;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
};

const DEFAULT_INTERVAL_MS = 20_000;
const DEFAULT_FOCUS_DEBOUNCE_MS = 3_000;
const DEFAULT_GROUPS_LIST_EVERY_N_TICKS = 3;

/**
 * Manages background revalidation for the cloud store:
 *  - a heartbeat every `intervalMs` that refreshes the active group (and the
 *    groups list every Nth sync), but only while the document is visible, the
 *    device is online, and the idle backoff allows another poll;
 *  - a visibilitychange/focus/online listener that triggers an immediate
 *    revalidate when the tab comes back or the network returns, debounced so a
 *    rapid tab-switch doesn't double-fire (skipped if the last sync was within
 *    `focusDebounceMs`);
 *  - pointer/key/scroll listeners that reset the idle backoff, and revalidate
 *    once on the way back down if polling had already backed off - so the data
 *    somebody starts touching is never three minutes stale;
 *  - start()/stop() lifecycle - start() is idempotent (calling it twice
 *    without an intervening stop() is a no-op), and stop() tears down both
 *    the interval and the listeners.
 *
 * All failures are swallowed silently (console.debug only) - this is
 * background, best-effort revalidation and must never surface user-facing
 * errors or toast spam.
 */
export function createAutoSync({ callbacks, config, timers, doc, win, nav, now }: CreateAutoSyncOptions) {
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
  const navImpl: AutoSyncNavigatorLike | null = nav ?? (typeof navigator !== "undefined" ? navigator : null);
  const nowImpl = now ?? (() => Date.now());
  const backoffRungs = config?.backoffRungs ?? BACKOFF_RUNGS;

  const INTERACTION_EVENTS: AutoSyncWindowEvent[] = ["pointerdown", "keydown", "scroll"];

  let intervalId: number | null = null;
  let syncCount = 0;
  let lastSyncAt = 0;
  let lastInteractionAt = 0;
  /**
   * Whether the ladder has climbed past its fastest rung. Cached rather than
   * recomputed inside noteInteraction because that runs on every scroll event:
   * the hot path has to stay one assignment and one boolean test.
   */
  let backedOff = false;
  let running = false;

  function isVisible(): boolean {
    return docImpl ? docImpl.visibilityState === "visible" : true;
  }

  /**
   * A missing navigator (SSR, a bare test harness) counts as online: refusing
   * to sync is the worse failure, and every request already fails silently.
   */
  function isOnline(): boolean {
    return navImpl ? navImpl.onLine !== false : true;
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
    // Offline: the fetch would fail anyway, and on a phone with no bars that is
    // a radio wake-up every 20 seconds for nothing. The `online` listener picks
    // the sync back up the moment the network returns.
    if (!isOnline()) return;

    const dueAfterMs = resolvePollIntervalMs(nowImpl() - lastInteractionAt, backoffRungs, intervalMs);
    backedOff = dueAfterMs > intervalMs;
    if (nowImpl() - lastSyncAt < dueAfterMs) return;

    syncCount += 1;
    const includeGroupsList = syncCount % groupsListEveryNTicks === 0;
    revalidate(includeGroupsList);
  }

  function handleFocusOrVisible() {
    if (!isVisible()) return;
    if (!isOnline()) return;
    // Coming back to the app is itself activity: restart the ladder, or a tab
    // that was parked for an hour would still be on the 3-minute rung.
    lastInteractionAt = nowImpl();
    backedOff = false;
    if (nowImpl() - lastSyncAt < focusDebounceMs) return;
    revalidate(true);
  }

  function handleVisibilityChange() {
    if (docImpl?.visibilityState === "visible") {
      handleFocusOrVisible();
    }
  }

  /**
   * Any touch, key or scroll resets the backoff ladder. If it had already
   * climbed, sync once on the way down too - somebody who starts reading again
   * after five idle minutes should not be looking at three-minute-old balances
   * while waiting for the next tick. Routed through handleFocusOrVisible so
   * that catch-up sync inherits the same debounce, and a burst of scroll events
   * can only ever produce one request.
   */
  function noteInteraction() {
    lastInteractionAt = nowImpl();
    if (!backedOff) return;
    handleFocusOrVisible();
  }

  function start() {
    if (running) return;
    running = true;
    syncCount = 0;
    lastInteractionAt = nowImpl();
    backedOff = false;
    intervalId = timersImpl.setInterval(handleTick, intervalMs);
    docImpl?.addEventListener("visibilitychange", handleVisibilityChange);
    winImpl?.addEventListener("focus", handleFocusOrVisible);
    winImpl?.addEventListener("online", handleFocusOrVisible);
    for (const type of INTERACTION_EVENTS) {
      // Passive: scroll is the highest-frequency of these by far, and this
      // listener must never be a reason the compositor waits on the main thread.
      winImpl?.addEventListener(type, noteInteraction, { passive: true });
    }
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
    winImpl?.removeEventListener("online", handleFocusOrVisible);
    for (const type of INTERACTION_EVENTS) {
      winImpl?.removeEventListener(type, noteInteraction);
    }
  }

  return { start, stop };
}

export type AutoSync = ReturnType<typeof createAutoSync>;
