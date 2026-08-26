import { LOCALE_KEY } from "./app/i18n/locale";

/**
 * Pin the language the tests render in.
 *
 * Without this the suite renders in whatever language the runner reports, and
 * assertions written against the shipped 繁體中文 UI fail for a reason that has
 * nothing to do with the behaviour under test.
 *
 * Both halves below are needed, and the second one is the one that is easy to
 * miss: modern Node defines a global `navigator`, so the node-environment tests
 * have a browser language too — one that says en-US on CI. Pinning only
 * localStorage passed locally (on a Node old enough to have no `navigator`) and
 * failed on CI, which is the worst possible way to find this out.
 *
 * Locale-specific behaviour is not left to this default: the i18n tests set the
 * locale explicitly and assert both languages.
 */

// jsdom: a saved preference, which is what resolveLocale checks first.
try {
  localStorage.setItem(LOCALE_KEY, "zh-Hant");
} catch {
  // No DOM here, or site data is blocked. The navigator pin below still applies.
}

// node (and jsdom, harmlessly): make the ambient browser language deterministic
// rather than whatever the runtime happens to report.
try {
  if (typeof navigator !== "undefined") {
    Object.defineProperty(navigator, "languages", { value: ["zh-TW"], configurable: true });
    Object.defineProperty(navigator, "language", { value: "zh-TW", configurable: true });
  }
} catch {
  // A runtime that refuses the redefinition still lands on 繁體中文, because
  // that is resolveLocale's final fallback.
}
