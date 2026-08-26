import { EN } from "./i18n/en.js";
import { resolveLocale, type Locale } from "./i18n/locale.js";
import { ZH_HANT } from "./i18n/zhHant.js";
import type { UiDictionary } from "./i18n/dictionary.js";

const DICTIONARIES: Record<Locale, UiDictionary> = {
  "zh-Hant": ZH_HANT,
  en: EN,
};

/**
 * The locale this page is rendering in, fixed for its lifetime.
 *
 * Read once at module load, before anything binds its strings - see
 * i18n/locale.ts's resolveLocale for why switching reloads instead of
 * re-rendering.
 */
export const ACTIVE_LOCALE: Locale = resolveLocale();

/**
 * Every string the app shows, in the active language.
 *
 * Kept at this path and under this name so the ~30 modules that do
 * `const text = UI_TEXT.app` at import time did not have to change when
 * translation arrived.
 */
export const UI_TEXT: UiDictionary = DICTIONARIES[ACTIVE_LOCALE];
