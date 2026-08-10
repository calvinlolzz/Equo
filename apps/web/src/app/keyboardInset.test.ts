// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { installKeyboardInset, keyboardOverlap, type VisualViewportLike } from "./keyboardInset";

describe("keyboardOverlap", () => {
  test("iOS: the layout viewport stays full height, so the keyboard is the difference", () => {
    // iPhone 14, keyboard up: innerHeight unchanged, visual viewport shrinks.
    expect(keyboardOverlap({ innerHeight: 844, viewportHeight: 508, offsetTop: 0 })).toBe(336);
  });

  test("iOS: a field scrolled into view shows up as offsetTop, and still counts", () => {
    // Same keyboard, but Safari has scrolled the visual viewport up by 120px.
    expect(keyboardOverlap({ innerHeight: 844, viewportHeight: 508, offsetTop: 120 })).toBe(216);
  });

  test("Android: the layout viewport shrinks with the keyboard, so there is nothing to correct", () => {
    expect(keyboardOverlap({ innerHeight: 508, viewportHeight: 508, offsetTop: 0 })).toBe(0);
  });

  test("no keyboard is zero, on any screen", () => {
    expect(keyboardOverlap({ innerHeight: 844, viewportHeight: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardOverlap({ innerHeight: 800, viewportHeight: 800, offsetTop: 0 })).toBe(0);
  });

  test("rounding noise and pinch-zoom slivers are not a keyboard", () => {
    expect(keyboardOverlap({ innerHeight: 844, viewportHeight: 843.4, offsetTop: 0 })).toBe(0);
    expect(keyboardOverlap({ innerHeight: 844, viewportHeight: 824, offsetTop: 0 })).toBe(0);
  });

  test("a negative overlap never grows the sheet", () => {
    // Browsers report this transiently while the keyboard animates away.
    expect(keyboardOverlap({ innerHeight: 508, viewportHeight: 844, offsetTop: 0 })).toBe(0);
  });
});

/** A visualViewport stand-in whose height can be driven from a test. */
function fakeViewport(height: number) {
  const listeners = new Map<string, Set<() => void>>();
  const vv: VisualViewportLike = {
    height,
    offsetTop: 0,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
  };
  const emit = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  const listenerCount = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return { vv, emit, listenerCount };
}

describe("installKeyboardInset", () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    teardowns.splice(0).forEach((fn) => fn());
    document.documentElement.style.removeProperty("--keyboard-inset");
  });

  const install = (...args: Parameters<typeof installKeyboardInset>) => {
    const teardown = installKeyboardInset(...args);
    teardowns.push(teardown);
    return teardown;
  };

  test("publishes the overlap on <html> when the keyboard opens", () => {
    window.innerHeight = 844;
    const { vv, emit } = fakeViewport(844);
    const root = document.documentElement;

    install(vv, root);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("0px");

    vv.height = 508;
    emit("resize");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("336px");

    vv.height = 844;
    emit("resize");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("0px");
  });

  test("a visual-viewport scroll republishes too — iOS moves offsetTop, not height", () => {
    window.innerHeight = 844;
    const { vv, emit } = fakeViewport(508);
    const root = document.documentElement;

    install(vv, root);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("336px");

    vv.offsetTop = 100;
    emit("scroll");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("236px");
  });

  test("teardown removes the listeners and the variable", () => {
    window.innerHeight = 844;
    const { vv, emit, listenerCount } = fakeViewport(508);
    const root = document.documentElement;

    const stop = installKeyboardInset(vv, root);
    expect(listenerCount()).toBe(2);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("336px");

    stop();
    expect(listenerCount()).toBe(0);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("");

    // And a late event can't resurrect it.
    vv.height = 300;
    emit("resize");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("");
  });

  test("a browser with no visualViewport is a no-op with a safe teardown", () => {
    const root = document.documentElement;

    const stop = installKeyboardInset(null, root);

    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("");
    expect(() => stop()).not.toThrow();
  });
});
