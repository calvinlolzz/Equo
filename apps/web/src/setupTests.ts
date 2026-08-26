import { LOCALE_KEY } from "./app/i18n/locale";

/**
 * Pin the language the tests render in.
 *
 * Without this the suite renders in whatever `navigator.languages` the runner's
 * jsdom reports, which is en-US - so assertions written against the shipped
 * 繁體中文 UI started failing the moment translation existed, for a reason that
 * had nothing to do with the behaviour under test.
 *
 * Pinned rather than left to chance because a test that only passes on machines
 * whose test runner reports one particular language is not a test. Locale-
 * specific behaviour is covered by the i18n tests, which set the locale
 * explicitly and assert both languages.
 *
 * Node-environment tests have no localStorage; they need nothing here, since
 * resolveLocale already falls through to 繁體中文 when there is neither storage
 * nor a navigator.
 */
try {
  localStorage.setItem(LOCALE_KEY, "zh-Hant");
} catch {
  // No DOM in this file's environment, or site data is blocked. Either way the
  // fallback already lands on 繁體中文.
}
