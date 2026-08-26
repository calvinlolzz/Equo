import { describe, expect, test } from "vitest";
import { resolveLocale } from "./app/i18n/locale";
import { ACTIVE_LOCALE } from "./app/uiText";

/**
 * A guard on the test setup itself.
 *
 * The suite asserts against 繁體中文 strings in hundreds of places. Which
 * language it actually renders in depends on the machine: Node derives
 * `navigator.language` from the operating system, so this passed locally (a
 * zh-TW machine) and failed on CI (en-US) with twenty unrelated-looking string
 * mismatches and nothing pointing at the cause.
 *
 * These two tests make that failure mode arrive as one obvious red line instead.
 * Runs in the node environment on purpose - that is the half that was missed.
 */
describe("test locale pinning", () => {
  test("the ambient browser language is pinned, whatever the machine says", () => {
    expect(navigator.language).toBe("zh-TW");
  });

  test("the app therefore renders in 繁體中文", () => {
    expect(ACTIVE_LOCALE).toBe("zh-Hant");
  });

  test("resolveLocale really does read the ambient navigator", () => {
    // Proves the pin above is load-bearing rather than coincidental: change what
    // the environment reports and the resolved locale follows it.
    const original = Object.getOwnPropertyDescriptor(navigator, "languages");
    try {
      Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true });
      expect(resolveLocale({ getItem: () => null })).toBe("en");
    } finally {
      if (original) Object.defineProperty(navigator, "languages", original);
    }
  });
});
