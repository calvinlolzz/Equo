export const LOCALES = ["zh-Hant", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-Hant";
export const LOCALE_KEY = "equo.clean.locale";

/** What each language calls itself. Never translated - a language picker that
 *  names languages in a language you cannot read is useless to the one person
 *  who needs it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  "zh-Hant": "繁體中文",
  en: "English",
};

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Best match for a browser language tag: "en-GB" and "en" both mean English,
 * while "zh-TW"/"zh-Hant-HK"/"zh" all mean the Chinese dictionary. Anything
 * else falls through to null so the caller can keep looking.
 */
export function matchLocale(tag: string | undefined | null): Locale | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) return "zh-Hant";
  if (lower.startsWith("en")) return "en";
  return null;
}

/**
 * The locale to render in, decided ONCE at startup.
 *
 * Order: an explicit choice the user saved, then what the browser asks for,
 * then 繁體中文. The saved choice wins over the browser deliberately - someone
 * on a borrowed phone set to English who picked 中文 meant it.
 *
 * Resolved once rather than watched, because ~30 modules bind their strings at
 * import time (`const text = UI_TEXT.app`). Switching language therefore
 * reloads the page - see setLocale. That is a real trade: a reload is visible.
 * It buys not having to thread a hook through every one of those modules for a
 * setting almost nobody changes twice, and nothing is lost across it (the
 * offline write queue and the group cache both live in localStorage).
 */
export function resolveLocale(storage?: Pick<Storage, "getItem">, languages?: readonly string[]): Locale {
  const store = storage ?? safeStorage();

  try {
    const saved = store?.getItem(LOCALE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // A browser with site data blocked throws on read. Fall through.
  }

  const tags = languages ?? (typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
  for (const tag of tags) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }

  return DEFAULT_LOCALE;
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Save a choice and reload so every module re-reads its strings.
 *
 * Saving even when the locale is unchanged would be harmless, but reloading
 * would not be - so a pick of the language already in use does nothing.
 */
export function setLocale(next: Locale, current: Locale, reload?: () => void): void {
  try {
    safeStorage()?.setItem(LOCALE_KEY, next);
  } catch {
    // Storage blocked: the language still applies for this page, it just will
    // not be remembered. Better than refusing to switch at all.
  }

  if (next === current) return;

  if (reload) {
    reload();
  } else if (typeof window !== "undefined") {
    window.location.reload();
  }
}
