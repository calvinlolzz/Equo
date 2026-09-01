// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import {
  BACKGROUND_MOTION_KEY,
  BACKGROUND_UNAVAILABLE_ATTR,
  applyBackgroundMotion,
  initBackgroundMotion,
  isBackgroundUnavailable,
  readStoredBackgroundMotion,
  storeBackgroundMotion,
} from "./backgroundStore";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-bg-motion");
  document.documentElement.removeAttribute(BACKGROUND_UNAVAILABLE_ATTR);
});

describe("readStoredBackgroundMotion", () => {
  test("defaults to on — the animated field is the shipped look", () => {
    expect(readStoredBackgroundMotion()).toBe("on");
  });

  test("reads a stored choice back", () => {
    storeBackgroundMotion("off");
    expect(readStoredBackgroundMotion()).toBe("off");
    storeBackgroundMotion("on");
    expect(readStoredBackgroundMotion()).toBe("on");
  });

  test("junk in storage is not a setting", () => {
    window.localStorage.setItem(BACKGROUND_MOTION_KEY, "yes-please");
    expect(readStoredBackgroundMotion()).toBe("on");
  });
});

describe("applyBackgroundMotion", () => {
  test("off is an attribute on <html>; on is its absence", () => {
    // GlassBackground is a sibling of <App />, so the root element is the seam
    // it watches — this attribute IS the wiring, not a convenience.
    applyBackgroundMotion("off");
    expect(document.documentElement.getAttribute("data-bg-motion")).toBe("off");

    applyBackgroundMotion("on");
    expect(document.documentElement.hasAttribute("data-bg-motion")).toBe(false);
  });

  test("init applies the stored choice, not the default", () => {
    storeBackgroundMotion("off");
    expect(initBackgroundMotion()).toBe("off");
    expect(document.documentElement.getAttribute("data-bg-motion")).toBe("off");
  });

  test("init on a fresh device leaves the field running", () => {
    expect(initBackgroundMotion()).toBe("on");
    expect(document.documentElement.hasAttribute("data-bg-motion")).toBe(false);
  });
});

describe("isBackgroundUnavailable", () => {
  test("reports what GlassBackground found, and nothing by default", () => {
    expect(isBackgroundUnavailable()).toBe(false);

    document.documentElement.setAttribute(BACKGROUND_UNAVAILABLE_ATTR, "");
    expect(isBackgroundUnavailable()).toBe(true);
  });

  test("is independent of the switch", () => {
    // "I turned it off" and "this machine cannot draw it" are different states
    // and the profile row says different things about them.
    applyBackgroundMotion("off");
    expect(isBackgroundUnavailable()).toBe(false);
  });
});
