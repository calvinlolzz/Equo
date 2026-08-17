import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BACKOFF_RUNGS,
  createAutoSync,
  resolvePollIntervalMs,
  type AutoSyncDocumentLike,
  type AutoSyncNavigatorLike,
  type AutoSyncTimers,
  type AutoSyncWindowEvent,
  type AutoSyncWindowLike,
} from "./autoSync";

type Listener = () => void;

function fakeDocument(initialVisibility: "visible" | "hidden" = "visible") {
  let visibilityState: "visible" | "hidden" = initialVisibility;
  const listeners: Record<"visibilitychange", Set<Listener>> = { visibilitychange: new Set() };

  const doc: AutoSyncDocumentLike = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type, listener) {
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type].delete(listener);
    },
  };

  return {
    doc,
    setVisibility(next: "visible" | "hidden") {
      visibilityState = next;
      listeners.visibilitychange.forEach((listener) => listener());
    },
  };
}

function fakeWindow() {
  const listeners = new Map<AutoSyncWindowEvent, Set<Listener>>();

  const win: AutoSyncWindowLike = {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };

  function fire(type: AutoSyncWindowEvent) {
    listeners.get(type)?.forEach((listener) => listener());
  }

  return {
    win,
    fire,
    fireFocus: () => fire("focus"),
    listenerCount: (type: AutoSyncWindowEvent) => listeners.get(type)?.size ?? 0,
  };
}

function fakeNavigator(initialOnline = true) {
  const nav: AutoSyncNavigatorLike = { onLine: initialOnline };
  return {
    nav,
    setOnline(next: boolean) {
      nav.onLine = next;
    },
  };
}

/**
 * A fired interval implies its own period has elapsed, so tick() advances the
 * injected clock by the registered interval. That coupling matters now that the
 * backoff gates each tick on how long it has been since the last sync — a tick
 * against a frozen clock is a state the real timer can never produce.
 */
function fakeTimers(advance: (ms: number) => void) {
  const handlers = new Map<number, { handler: () => void; ms: number }>();
  let nextId = 1;

  const timers: AutoSyncTimers = {
    setInterval(handler, ms) {
      const id = nextId;
      nextId += 1;
      handlers.set(id, { handler, ms });
      return id;
    },
    clearInterval(id) {
      handlers.delete(id);
    },
  };

  return {
    timers,
    tick(times = 1) {
      for (let i = 0; i < times; i += 1) {
        handlers.forEach(({ handler, ms }) => {
          advance(ms);
          handler();
        });
      }
    },
    activeCount() {
      return handlers.size;
    },
  };
}

describe("autoSync", () => {
  let clock: number;
  const now = () => clock;
  const advance = (ms: number) => {
    clock += ms;
  };

  /**
   * A single-rung ladder: poll every 20s no matter how idle the user is. Used
   * by the tests that are about tick cadence rather than about the backoff, so
   * the two behaviours are never asserted through one another.
   */
  const FLAT_LADDER = [{ idleAfterMs: 0, intervalMs: 20_000 }];

  beforeEach(() => {
    clock = 1_000_000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("visible interval tick refreshes the active group but not the groups list on ticks 1-2", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers, tick } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      config: { backoffRungs: FLAT_LADDER },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    tick();
    expect(refreshActiveGroup).toHaveBeenCalledTimes(1);
    expect(refreshGroups).not.toHaveBeenCalled();

    tick();
    expect(refreshActiveGroup).toHaveBeenCalledTimes(2);
    expect(refreshGroups).not.toHaveBeenCalled();

    autoSync.stop();
  });

  test("every 3rd sync also refreshes the groups list", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers, tick } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      config: { backoffRungs: FLAT_LADDER },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    tick(3);
    expect(refreshActiveGroup).toHaveBeenCalledTimes(3);
    expect(refreshGroups).toHaveBeenCalledTimes(1);

    tick(3);
    expect(refreshActiveGroup).toHaveBeenCalledTimes(6);
    expect(refreshGroups).toHaveBeenCalledTimes(2);

    autoSync.stop();
  });

  test("hidden interval tick skips refresh entirely", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("hidden");
    const { win } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers, tick } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    tick(3);

    expect(refreshActiveGroup).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();

    autoSync.stop();
  });

  test("focus triggers an immediate revalidate (including groups list)", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win, fireFocus } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    fireFocus();

    expect(refreshActiveGroup).toHaveBeenCalledTimes(1);
    expect(refreshGroups).toHaveBeenCalledTimes(1);

    autoSync.stop();
  });

  test("focus debounce: a second focus within 3s of the last sync is skipped", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win, fireFocus } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    fireFocus();
    expect(refreshActiveGroup).toHaveBeenCalledTimes(1);

    clock += 1_000; // within the 3s debounce window
    fireFocus();
    expect(refreshActiveGroup).toHaveBeenCalledTimes(1);

    clock += 3_000; // now past the debounce window
    fireFocus();
    expect(refreshActiveGroup).toHaveBeenCalledTimes(2);

    autoSync.stop();
  });

  test("visibilitychange to visible triggers a debounced revalidate the same as focus", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc, setVisibility } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    setVisibility("hidden");
    setVisibility("visible");

    expect(refreshActiveGroup).toHaveBeenCalledTimes(1);

    autoSync.stop();
  });

  test("stop() cleans up the interval and every listener so no further callbacks fire", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win, fireFocus, fire, listenerCount } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers, tick, activeCount } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();
    expect(activeCount()).toBe(1);
    expect(listenerCount("scroll")).toBe(1);
    expect(listenerCount("online")).toBe(1);

    autoSync.stop();
    expect(activeCount()).toBe(0);
    expect(listenerCount("scroll")).toBe(0);
    expect(listenerCount("online")).toBe(0);
    expect(listenerCount("pointerdown")).toBe(0);
    expect(listenerCount("keydown")).toBe(0);

    tick();
    fireFocus();
    fire("online");
    fire("pointerdown");

    expect(refreshActiveGroup).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  test("start() is idempotent while already running", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win, listenerCount } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers, activeCount } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();
    autoSync.start();

    expect(activeCount()).toBe(1);
    expect(listenerCount("scroll")).toBe(1);

    autoSync.stop();
  });

  test("background sync failures are swallowed silently via console.debug, never thrown", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const refreshActiveGroup = vi.fn().mockRejectedValue(new Error("network down"));
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { nav } = fakeNavigator();
    const { timers, tick } = fakeTimers(advance);

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      nav,
      now,
    });

    autoSync.start();

    expect(() => tick()).not.toThrow();

    autoSync.stop();

    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      expect(debugSpy).toHaveBeenCalled();
    });
  });

  describe("resolvePollIntervalMs", () => {
    test("walks the default ladder as idle time grows", () => {
      const rung = (idleMs: number) => resolvePollIntervalMs(idleMs, BACKOFF_RUNGS, 20_000);

      expect(rung(0)).toBe(20_000);
      expect(rung(59_999)).toBe(20_000);
      expect(rung(60_000)).toBe(60_000);
      expect(rung(299_999)).toBe(60_000);
      expect(rung(300_000)).toBe(180_000);
      expect(rung(60 * 60_000)).toBe(180_000);
    });

    test("an empty ladder falls back to the base interval", () => {
      expect(resolvePollIntervalMs(999_999, [], 20_000)).toBe(20_000);
    });
  });

  describe("idle backoff", () => {
    test("an untouched tab stops polling every tick once it goes idle", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win } = fakeWindow();
      const { nav } = fakeNavigator();
      const { timers, tick } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();

      // The first two ticks are inside the 1-minute active window, so they poll
      // at the old cadence.
      tick(2);
      expect(refreshActiveGroup).toHaveBeenCalledTimes(2);

      // Ticks 3 and 4 land on the 60s rung with only 20s and 40s since the last
      // sync, so both are skipped; tick 5 is 60s past it and goes through.
      tick(2);
      expect(refreshActiveGroup).toHaveBeenCalledTimes(2);

      tick();
      expect(refreshActiveGroup).toHaveBeenCalledTimes(3);

      autoSync.stop();
    });

    test("an hour parked costs a fraction of the requests a fixed interval would", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win } = fakeWindow();
      const { nav } = fakeNavigator();
      const { timers, tick } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();

      tick(180); // 180 × 20s = one hour of heartbeats, nobody touching anything

      // A fixed 20s interval would have made 180 of these.
      expect(refreshActiveGroup).toHaveBeenCalledTimes(24);

      autoSync.stop();
    });

    test("interaction after backing off resets the ladder and catches up once", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win, fire } = fakeWindow();
      const { nav } = fakeNavigator();
      const { timers, tick } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();

      tick(20); // well into the backed-off rungs
      const backedOffCalls = refreshActiveGroup.mock.calls.length;

      // Touching the screen syncs immediately rather than leaving the reader on
      // data that could be three minutes old.
      fire("pointerdown");
      expect(refreshActiveGroup).toHaveBeenCalledTimes(backedOffCalls + 1);

      // ...and the ladder is back on its fast rung, so the next two ticks poll.
      tick(2);
      expect(refreshActiveGroup).toHaveBeenCalledTimes(backedOffCalls + 3);

      autoSync.stop();
    });

    test("interaction while already on the fast rung never fires a request of its own", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win, fire } = fakeWindow();
      const { nav } = fakeNavigator();
      const { timers, tick } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();
      tick();
      expect(refreshActiveGroup).toHaveBeenCalledTimes(1);

      // A scroll is a hundred of these. None of them may become a request.
      for (let i = 0; i < 100; i += 1) fire("scroll");
      expect(refreshActiveGroup).toHaveBeenCalledTimes(1);

      autoSync.stop();
    });
  });

  describe("offline", () => {
    test("ticks are skipped while the device is offline", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win } = fakeWindow();
      const { nav, setOnline } = fakeNavigator();
      const { timers, tick } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        config: { backoffRungs: FLAT_LADDER },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();
      setOnline(false);

      tick(5);
      expect(refreshActiveGroup).not.toHaveBeenCalled();

      autoSync.stop();
    });

    test("a focus while offline does not fire a doomed request either", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win, fireFocus } = fakeWindow();
      const { nav, setOnline } = fakeNavigator();
      const { timers } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();
      setOnline(false);
      fireFocus();

      expect(refreshActiveGroup).not.toHaveBeenCalled();

      autoSync.stop();
    });

    test("coming back online revalidates immediately instead of waiting for the next tick", () => {
      const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
      const refreshGroups = vi.fn().mockResolvedValue(undefined);
      const { doc } = fakeDocument("visible");
      const { win, fire } = fakeWindow();
      const { nav, setOnline } = fakeNavigator();
      const { timers, tick } = fakeTimers(advance);

      const autoSync = createAutoSync({
        callbacks: { refreshActiveGroup, refreshGroups },
        config: { backoffRungs: FLAT_LADDER },
        timers,
        doc,
        win,
        nav,
        now,
      });

      autoSync.start();
      setOnline(false);
      tick(5);
      expect(refreshActiveGroup).not.toHaveBeenCalled();

      setOnline(true);
      fire("online");

      expect(refreshActiveGroup).toHaveBeenCalledTimes(1);
      expect(refreshGroups).toHaveBeenCalledTimes(1);

      autoSync.stop();
    });
  });
});
