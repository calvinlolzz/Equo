// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { RAIL_KEY, applyRail, initRail, readStoredRail, storeRail } from "./railStore";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-rail");
});

describe("readStoredRail", () => {
  test("defaults to collapsed — the strip is the resting state", () => {
    expect(readStoredRail()).toBe("collapsed");
  });

  test("reads a stored choice back", () => {
    storeRail("expanded");
    expect(readStoredRail()).toBe("expanded");
    storeRail("collapsed");
    expect(readStoredRail()).toBe("collapsed");
  });

  test("junk in storage is not a setting", () => {
    window.localStorage.setItem(RAIL_KEY, "wide-open");
    expect(readStoredRail()).toBe("collapsed");
  });

  test("a throwing localStorage does not throw out of the reader", () => {
    const getItem = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredRail()).toBe("collapsed");
    getItem.mockRestore();
  });
});

describe("applyRail", () => {
  test("expanded is an attribute on <html>; collapsed is its absence", () => {
    applyRail("expanded");
    expect(document.documentElement.getAttribute("data-rail")).toBe("expanded");

    applyRail("collapsed");
    expect(document.documentElement.hasAttribute("data-rail")).toBe(false);
  });

  test("init applies the stored choice, not the default", () => {
    storeRail("expanded");
    expect(initRail()).toBe("expanded");
    expect(document.documentElement.getAttribute("data-rail")).toBe("expanded");
  });

  test("init on a fresh device leaves the rail collapsed with no attribute", () => {
    expect(initRail()).toBe("collapsed");
    expect(document.documentElement.hasAttribute("data-rail")).toBe(false);
  });
});

describe("storeRail", () => {
  test("a throwing localStorage does not throw out of the writer", () => {
    const setItem = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeRail("expanded")).not.toThrow();
    setItem.mockRestore();
  });
});
