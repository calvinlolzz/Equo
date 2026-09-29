// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_LOCALE, LOCALE_KEY, LOCALES, matchLocale, resolveLocale, setLocale } from "./locale";
import { ZH_HANT } from "./zhHant";
import { EN } from "./en";

function storage(value: string | null) {
  return { getItem: () => value };
}

describe("matchLocale", () => {
  test.each([
    ["zh-TW", "zh-Hant"],
    ["zh-Hant-HK", "zh-Hant"],
    ["zh", "zh-Hant"],
    ["en-GB", "en"],
    ["en", "en"],
  ])("%s resolves to %s", (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });

  test.each([["ja"], ["ko-KR"], ["de"], [""], [null], [undefined]])(
    "%s matches nothing rather than guessing",
    (tag) => {
      expect(matchLocale(tag as string | null)).toBeNull();
    },
  );
});

describe("resolveLocale", () => {
  test("a saved choice wins over the browser", () => {
    // Someone on a borrowed phone set to English who picked 中文 meant it.
    expect(resolveLocale(storage("zh-Hant"), ["en-US"])).toBe("zh-Hant");
    expect(resolveLocale(storage("en"), ["zh-TW"])).toBe("en");
  });

  test("falls back to the browser when nothing is saved", () => {
    expect(resolveLocale(storage(null), ["en-GB", "zh-TW"])).toBe("en");
    expect(resolveLocale(storage(null), ["zh-TW"])).toBe("zh-Hant");
  });

  test("walks the whole preference list, not just the first entry", () => {
    // A browser set to Japanese first and English second should get English,
    // not the default, because English is a language it actually asked for.
    expect(resolveLocale(storage(null), ["ja-JP", "en-US"])).toBe("en");
  });

  test("falls back to the default when nothing matches", () => {
    expect(resolveLocale(storage(null), ["ja-JP", "ko-KR"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(storage(null), [])).toBe(DEFAULT_LOCALE);
  });

  test("ignores a saved value that is not a language we have", () => {
    // A stale key from an older build, or someone editing localStorage. Picking
    // a dictionary that does not exist would render undefined everywhere.
    expect(resolveLocale(storage("klingon"), ["zh-TW"])).toBe("zh-Hant");
  });

  test("survives storage that throws, which is what a blocked browser does", () => {
    const throwing = {
      getItem() {
        throw new Error("site data blocked");
      },
    };
    expect(resolveLocale(throwing, ["en-US"])).toBe("en");
  });
});

describe("setLocale", () => {
  test("reloads when the language actually changes", () => {
    const reload = vi.fn();
    setLocale("en", "zh-Hant", reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("does nothing visible when the same language is picked again", () => {
    // Reloading the page to change nothing would look like a bug.
    const reload = vi.fn();
    setLocale("zh-Hant", "zh-Hant", reload);
    expect(reload).not.toHaveBeenCalled();
  });

  test("remembers the choice", () => {
    setLocale("en", "zh-Hant", () => {});
    expect(localStorage.getItem(LOCALE_KEY)).toBe("en");
    // Put it back for the rest of the suite (setupTests pins zh-Hant).
    setLocale("zh-Hant", "en", () => {});
  });
});

describe("dictionaries", () => {
  test("every locale is listed", () => {
    expect([...LOCALES].sort()).toEqual(["en", "zh-Hant"]);
  });

  /**
   * English strings that are empty ON PURPOSE, because Chinese needs a word
   * there and English does not: counter words after a number, and prefixes on
   * sentences whose English word order puts the number first.
   *
   * Listed explicitly so the completeness check below is a real check. Without
   * the list it would have to allow every empty string, which is exactly the
   * failure it exists to catch.
   */
  const INTENTIONALLY_EMPTY_IN_EN = new Set([
    "recurring.daySuffix",
    "periods.monthSuffix",
    "records.matchPrefix",
    "settlement.historyTruncatedPrefix",
  ]);

  test("no English string was left blank", () => {
    // The mapped type makes a MISSING key a compile error. It cannot see a key
    // that is present but empty, which is what a half-finished translation
    // looks like - and an empty label renders as nothing at all.
    const blanks: string[] = [];

    for (const section of Object.keys(ZH_HANT) as Array<keyof typeof ZH_HANT>) {
      for (const key of Object.keys(ZH_HANT[section])) {
        const path = `${section}.${key}`;
        const translated = (EN[section] as Record<string, string>)[key];
        if (translated.trim() === "" && !INTENTIONALLY_EMPTY_IN_EN.has(path)) blanks.push(path);
      }
    }

    expect(blanks).toEqual([]);
  });

  test("the deliberately-empty list has no stale entries", () => {
    // If one of these gains a translation the entry should go, or it silently
    // exempts a real string from the check above.
    const stale = [...INTENTIONALLY_EMPTY_IN_EN].filter((path) => {
      const [section, key] = path.split(".") as [keyof typeof ZH_HANT, string];
      return (EN[section] as Record<string, string>)[key].trim() !== "";
    });
    expect(stale).toEqual([]);
  });

  test("the two dictionaries have exactly the same shape", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH_HANT).sort());
    for (const section of Object.keys(ZH_HANT) as Array<keyof typeof ZH_HANT>) {
      expect(Object.keys(EN[section]).sort()).toEqual(Object.keys(ZH_HANT[section]).sort());
    }
  });

  test("placeholder templates keep their placeholders in both languages", () => {
    // A translation that drops {pct} renders a sentence with the number missing
    // and nothing to show that anything went wrong.
    const templated = ["aboutTheSame", "more", "less"] as const;
    for (const key of templated) {
      expect(ZH_HANT.comparison[key]).toContain("{period}");
      expect(EN.comparison[key]).toContain("{period}");
    }
    expect(ZH_HANT.comparison.more).toContain("{pct}");
    expect(EN.comparison.more).toContain("{pct}");

    expect(ZH_HANT.records.entryCount).toContain("{n}");
    expect(EN.records.entryCount).toContain("{n}");
    expect(ZH_HANT.spend.budgetUsage).toContain("{pct}");
    expect(ZH_HANT.spend.budgetUsage).toContain("{amount}");
    expect(EN.spend.budgetUsage).toContain("{pct}");
    expect(EN.spend.budgetUsage).toContain("{amount}");

    expect(ZH_HANT.lineLink.confirmAccount).toContain("{email}");
    expect(EN.lineLink.confirmAccount).toContain("{email}");
  });
});
