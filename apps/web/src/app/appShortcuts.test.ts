// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { clearShortcutParam, readShortcutAction } from "./appShortcuts";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("readShortcutAction", () => {
  test("reads the actions the manifest declares", () => {
    expect(readShortcutAction("?shortcut=add-expense")).toBe("add-expense");
    expect(readShortcutAction("?shortcut=join")).toBe("join");
  });

  test("ignores anything it cannot act on", () => {
    // An unimplemented action must read as "no shortcut" rather than silently
    // opening the wrong thing.
    expect(readShortcutAction("?shortcut=settle")).toBeNull();
    expect(readShortcutAction("?shortcut=")).toBeNull();
    expect(readShortcutAction("")).toBeNull();
    expect(readShortcutAction("?invite=EQO-123")).toBeNull();
  });
});

describe("clearShortcutParam", () => {
  test("removes only the shortcut param, keeping the rest of the URL", () => {
    window.history.replaceState(null, "", "/group/g1?shortcut=add-expense&invite=EQO-9#x");

    clearShortcutParam();

    // ?invite= must survive: it drives the join flow and is consumed elsewhere.
    expect(window.location.search).toBe("?invite=EQO-9");
    expect(window.location.pathname).toBe("/group/g1");
    expect(window.location.hash).toBe("#x");
  });

  test("is a no-op when there is no shortcut param", () => {
    window.history.replaceState(null, "", "/group/g1?invite=EQO-9");

    clearShortcutParam();

    expect(window.location.search).toBe("?invite=EQO-9");
  });
});
