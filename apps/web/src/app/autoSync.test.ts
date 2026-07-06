import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAutoSync, type AutoSyncDocumentLike, type AutoSyncTimers, type AutoSyncWindowLike } from "./autoSync";

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
  const listeners: Record<"focus", Set<Listener>> = { focus: new Set() };

  const win: AutoSyncWindowLike = {
    addEventListener(type, listener) {
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type].delete(listener);
    },
  };

  return {
    win,
    fireFocus() {
      listeners.focus.forEach((listener) => listener());
    },
  };
}

function fakeTimers() {
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
    tick() {
      handlers.forEach(({ handler }) => handler());
    },
    activeCount() {
      return handlers.size;
    },
  };
}

describe("autoSync", () => {
  let clock: number;
  const now = () => clock;

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
    const { timers, tick } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
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

  test("every 3rd tick also refreshes the groups list", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { timers, tick } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      now,
    });

    autoSync.start();

    tick(); // 1
    tick(); // 2
    tick(); // 3
    expect(refreshActiveGroup).toHaveBeenCalledTimes(3);
    expect(refreshGroups).toHaveBeenCalledTimes(1);

    tick(); // 4
    tick(); // 5
    tick(); // 6
    expect(refreshActiveGroup).toHaveBeenCalledTimes(6);
    expect(refreshGroups).toHaveBeenCalledTimes(2);

    autoSync.stop();
  });

  test("hidden interval tick skips refresh entirely", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("hidden");
    const { win } = fakeWindow();
    const { timers, tick } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      now,
    });

    autoSync.start();

    tick();
    tick();
    tick();

    expect(refreshActiveGroup).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();

    autoSync.stop();
  });

  test("focus triggers an immediate revalidate (including groups list)", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win, fireFocus } = fakeWindow();
    const { timers } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
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
    const { timers } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
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
    const { timers } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      now,
    });

    autoSync.start();

    setVisibility("hidden");
    setVisibility("visible");

    expect(refreshActiveGroup).toHaveBeenCalledTimes(1);

    autoSync.stop();
  });

  test("stop() cleans up the interval and listeners so no further callbacks fire", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win, fireFocus } = fakeWindow();
    const { timers, tick, activeCount } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      now,
    });

    autoSync.start();
    expect(activeCount()).toBe(1);

    autoSync.stop();
    expect(activeCount()).toBe(0);

    tick();
    fireFocus();

    expect(refreshActiveGroup).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  test("start() is idempotent while already running", () => {
    const refreshActiveGroup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { timers, activeCount } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      now,
    });

    autoSync.start();
    autoSync.start();

    expect(activeCount()).toBe(1);

    autoSync.stop();
  });

  test("background sync failures are swallowed silently via console.debug, never thrown", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const refreshActiveGroup = vi.fn().mockRejectedValue(new Error("network down"));
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDocument("visible");
    const { win } = fakeWindow();
    const { timers, tick } = fakeTimers();

    const autoSync = createAutoSync({
      callbacks: { refreshActiveGroup, refreshGroups },
      timers,
      doc,
      win,
      now,
    });

    autoSync.start();

    expect(() => tick()).not.toThrow();

    autoSync.stop();

    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      expect(debugSpy).toHaveBeenCalled();
    });
  });
});
