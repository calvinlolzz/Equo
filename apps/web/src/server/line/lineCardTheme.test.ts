import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CATALOG, FALLBACK_CATEGORY_COLOR } from "../../app/catalog.js";
import {
  CARD,
  CATEGORY_FALLBACK_COLOR,
  LINE_CATEGORY_EMOJI,
  LINK_HERO_ASPECT,
  LINK_HERO_PATH,
  amountTextSize,
  barPercent,
  budgetTone,
  categoryDisplay,
  categoryEmoji,
  linkHeroUrl,
  mixHex,
  normalizeHexColor,
  tint,
  toneColor,
  usedPercent,
} from "./lineCardTheme.js";

describe("budgetTone", () => {
  // [MV]: `<` -> `<=` at 80%, or `<=` -> `<` at 100%, flips one of the two boundary rows.
  test.each([
    [0, "ok"],
    [-1, "ok"],
    [7999, "ok"],
    [8000, "warn"],
    [9999, "warn"],
    [10000, "warn"],
    [10001, "over"],
    [50000, "over"],
  ])("a budget of 10000 with %s spent is %s", (spent, tone) => {
    expect(budgetTone(spent, 10000)).toBe(tone);
  });

  test("holds at the largest budget the app allows (2,000,000,000 minor units)", () => {
    const budget = 2_000_000_000;
    expect(budgetTone(1_599_999_999, budget)).toBe("ok");
    expect(budgetTone(1_600_000_000, budget)).toBe("warn");
    expect(budgetTone(2_000_000_000, budget)).toBe("warn");
    expect(budgetTone(2_000_000_001, budget)).toBe("over");
  });

  test("toneColor: mint, amber, coral", () => {
    expect(toneColor("ok")).toBe(CARD.mint);
    expect(toneColor("warn")).toBe(CARD.amber);
    expect(toneColor("over")).toBe(CARD.coral);
  });
});

describe("barPercent", () => {
  test.each([
    [0, 100, 0],
    [-5, 100, 0],
    [50, 0, 0],
    [50, -1, 0],
    [Number.NaN, 100, 0],
    [50, Number.NaN, 0],
    [50, 100, 50],
    [7, 10, 70],
    [10000, 10000, 100],
    [10001, 10000, 100],
    [1_999_999_999, 2_000_000_000, 99],
  ])("%s of %s fills %s%%", (value, max, expected) => {
    expect(barPercent(value, max)).toBe(expected);
  });

  // [MV]: drop the Math.max(1, ...) and a tiny amount reads as an empty bar.
  test("a small non-zero amount still shows a 1% sliver", () => {
    expect(barPercent(1, 100_000)).toBe(1);
    expect(barPercent(1, 2_000_000_000)).toBe(1);
  });

  // [MV]: remove the `value >= max` clamp and 150% of a budget draws a bar of 150.
  test("never goes past 100", () => {
    expect(barPercent(15000, 10000)).toBe(100);
    expect(barPercent(10_000_000_000, 2_000_000_000)).toBe(100);
  });

  // [MV]: Math.round instead of Math.floor turns these into 67 and 100 - a bar that says full while there is still room.
  test("rounds down, so only a full amount fills the bar", () => {
    expect(barPercent(2, 3)).toBe(66);
    expect(barPercent(9999, 10000)).toBe(99);
  });
});

describe("usedPercent", () => {
  test.each([
    [0, 10000, 0],
    [7999, 10000, 79],
    [8000, 10000, 80],
    [10000, 10000, 100],
    [10001, 10000, 100],
    [6060, 15000, 40],
    [50000, 10000, 500],
  ])("%s of a budget of %s is %s%%", (spent, budget, expected) => {
    expect(usedPercent(spent, budget)).toBe(expected);
  });

  test("is 0 rather than Infinity or NaN when there is nothing to divide by", () => {
    expect(usedPercent(500, 0)).toBe(0);
    expect(usedPercent(500, -100)).toBe(0);
    expect(usedPercent(Number.NaN, 10000)).toBe(0);
  });
});

describe("amountTextSize", () => {
  test.each([
    ["$60", "3xl"],
    ["$1,234,567", "3xl"],
    ["-$12,345,678", "xxl"],
    ["$1,234,567,890", "xxl"],
    ["+$12,345,678,901", "xl"],
  ])("%s is %s", (amount, size) => {
    expect(amountTextSize(amount)).toBe(size);
  });

  test("the thresholds are 10 and 14 characters exactly", () => {
    expect(amountTextSize("1".repeat(10))).toBe("3xl");
    expect(amountTextSize("1".repeat(11))).toBe("xxl");
    expect(amountTextSize("1".repeat(14))).toBe("xxl");
    expect(amountTextSize("1".repeat(15))).toBe("xl");
  });

  test("counts characters, not UTF-16 units", () => {
    // Ten emoji are twenty units but ten characters.
    expect(amountTextSize("\u{1F371}".repeat(10))).toBe("3xl");
  });
});

describe("normalizeHexColor", () => {
  const FALLBACK = "#93A0B5";

  // [MV]: skip the normalization and "red" reaches LINE, which rejects the whole card.
  test.each([
    ["#abc", "#AABBCC"],
    ["#ABC", "#AABBCC"],
    ["#f0885a", "#F0885A"],
    ["#F0885A", "#F0885A"],
    ["red", FALLBACK],
    ["", FALLBACK],
    ["#12345", FALLBACK],
    ["#1234567", FALLBACK],
    ["#12345678", FALLBACK],
    ["#abcd", FALLBACK],
    ["F0885A", FALLBACK],
    ["#GGGGGG", FALLBACK],
    ["#abc\n", FALLBACK],
    [null, FALLBACK],
    [undefined, FALLBACK],
    [123, FALLBACK],
  ])("%j becomes %s", (value, expected) => {
    expect(normalizeHexColor(value, FALLBACK)).toBe(expected);
  });
});

describe("mixHex and tint", () => {
  test.each([
    ["#FFFFFF", "#000000", 0.5, "#808080"], // 127.5 rounds up
    ["#FF0000", "#0000FF", 0.25, "#4000BF"],
    ["#4DE3A6", "#12151F", 0.22, "#1F423D"],
    ["#000000", "#000000", 0.5, "#000000"], // zero-padded, not "#0"
    ["#FF0000", "#00FF00", 1, "#FF0000"],
    ["#FF0000", "#00FF00", 0, "#00FF00"],
    ["#FF0000", "#00FF00", 7, "#FF0000"], // alpha is clamped to 0-1
    ["#FF0000", "#00FF00", -1, "#00FF00"],
    ["#FF0000", "#00FF00", Number.NaN, "#00FF00"],
  ])("%s over %s at %s is %s", (fg, bg, alpha, expected) => {
    expect(mixHex(fg, bg, alpha)).toBe(expected);
  });

  test("tint is the colour at 22% over the card background", () => {
    expect(tint(CARD.mint)).toBe(mixHex(CARD.mint, CARD.bg, 0.22));
    expect(tint("#FFFFFF")).toBe("#464850");
  });
});

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("palette", () => {
  test("every colour is a plain #RRGGBB", () => {
    for (const [name, color] of Object.entries(CARD)) {
      expect(color, name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test.each(["text", "muted", "mint", "amber", "coral", "blue", "violet"] as const)(
    "%s holds 4.5:1 on both the card and the raised surface",
    (name) => {
      expect(contrast(CARD[name], CARD.bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(CARD[name], CARD.raised), `${name} on raised`).toBeGreaterThanOrEqual(4.5);
    },
  );

  // [MV]: use mint as the button fill and white-on-mint (1.63:1) fails this.
  test("the white label LINE draws on a primary button holds 4.5:1 on buttonBg", () => {
    expect(contrast("#FFFFFF", CARD.buttonBg)).toBeGreaterThanOrEqual(4.5);
  });

  test("which is exactly why mint is not the button fill", () => {
    expect(contrast("#FFFFFF", CARD.mint)).toBeLessThan(2);
  });

  test("the catalog fallback colour is the one catalog.ts uses (it cannot be imported by server code)", () => {
    expect(CATEGORY_FALLBACK_COLOR).toBe(FALLBACK_CATEGORY_COLOR);
  });
});

describe("category emoji", () => {
  // [MV]: delete one entry and this names the category that lost its emoji.
  test.each(DEFAULT_CATALOG.categories.map((category) => category.key))("%s has its own emoji", (key) => {
    expect(Object.hasOwn(LINE_CATEGORY_EMOJI, key)).toBe(true);
    expect(categoryEmoji(key)).toBe(LINE_CATEGORY_EMOJI[key]);
  });

  test("every emoji is one code point with Emoji_Presentation (no U+FE0F, no ZWJ sequence)", () => {
    for (const [key, emoji] of Object.entries(LINE_CATEGORY_EMOJI)) {
      expect(emoji, key).toMatch(/^\p{Emoji_Presentation}$/u);
    }
    expect(categoryEmoji("no_such_category")).toMatch(/^\p{Emoji_Presentation}$/u);
  });

  test("no two categories share an emoji", () => {
    const emoji = Object.values(LINE_CATEGORY_EMOJI);
    expect(new Set(emoji).size).toBe(emoji.length);
    expect(emoji).not.toContain(categoryEmoji("no_such_category"));
  });

  test("an unknown key gets the bookmark, and a key that is an Object.prototype name does not leak a function", () => {
    expect(categoryEmoji("no_such_category")).toBe("\u{1F516}");
    expect(categoryEmoji("constructor")).toBe("\u{1F516}");
    expect(categoryEmoji("__proto__")).toBe("\u{1F516}");
    expect(categoryEmoji("toString")).toBe("\u{1F516}");
  });
});

describe("categoryDisplay", () => {
  const catalog = [
    { key: "food", label: "餐飲", color: "#f0885a" },
    { key: "custom", label: "自訂分類", color: "#abc" },
    { key: "broken", label: "壞掉的顏色", color: "red" },
    { key: "unnamed", label: "", color: "" },
  ];

  test("zh shows the live catalog's label, the key when the catalog has none", () => {
    expect(categoryDisplay("food", catalog, "zh-Hant").label).toBe("餐飲");
    expect(categoryDisplay("custom", catalog, "zh-Hant").label).toBe("自訂分類");
    expect(categoryDisplay("ghost", catalog, "zh-Hant").label).toBe("ghost");
    expect(categoryDisplay("ghost", [], "zh-Hant").label).toBe("ghost");
  });

  test("a locale that is not English is read like zh", () => {
    expect(categoryDisplay("food", catalog, "fr").label).toBe("餐飲");
  });

  // [MV]: ignore the locale and an English user is shown 餐飲.
  test("en shows the app's own English label, whatever the catalog says", () => {
    expect(categoryDisplay("food", catalog, "en").label).toBe("Food");
    expect(categoryDisplay("other_income", [], "en").label).toBe("Other income");
  });

  test("en falls back to the catalog's label, then the key, for a category the app does not know", () => {
    expect(categoryDisplay("custom", catalog, "en").label).toBe("自訂分類");
    expect(categoryDisplay("ghost", catalog, "en").label).toBe("ghost");
  });

  test("a key that is an Object.prototype name is a plain unknown key, not a function", () => {
    for (const locale of ["zh-Hant", "en"]) {
      expect(categoryDisplay("constructor", [], locale).label).toBe("constructor");
      expect(categoryDisplay("__proto__", [], locale).label).toBe("__proto__");
    }
  });

  test("an empty catalog label stays empty here - the card's text() turns it into a dash", () => {
    expect(categoryDisplay("unnamed", catalog, "zh-Hant").label).toBe("");
  });

  test("normalizes the colour and falls back to grey for one LINE would reject", () => {
    expect(categoryDisplay("food", catalog, "zh-Hant").color).toBe("#F0885A");
    expect(categoryDisplay("custom", catalog, "zh-Hant").color).toBe("#AABBCC");
    expect(categoryDisplay("broken", catalog, "zh-Hant").color).toBe(CATEGORY_FALLBACK_COLOR);
    expect(categoryDisplay("unnamed", catalog, "zh-Hant").color).toBe(CATEGORY_FALLBACK_COLOR);
    expect(categoryDisplay("ghost", catalog, "zh-Hant").color).toBe(CATEGORY_FALLBACK_COLOR);
  });

  test("carries the key and its emoji", () => {
    expect(categoryDisplay("food", catalog, "zh-Hant")).toMatchObject({ key: "food", emoji: LINE_CATEGORY_EMOJI.food });
    expect(categoryDisplay("ghost", catalog, "zh-Hant")).toMatchObject({ key: "ghost", emoji: categoryEmoji("ghost") });
  });
});

describe("the link card's hero image", () => {
  const heroFile = join(__dirname, "..", "..", "..", "public", ...LINK_HERO_PATH.split("/").filter(Boolean));

  /** The first start-of-frame segment of a JPEG: its marker (0xC0 is baseline) and pixel size. */
  function readJpegFrame(bytes: Uint8Array): { marker: number; width: number; height: number } {
    let offset = 2; // past the FF D8 that starts every JPEG
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error(`expected a JPEG marker at byte ${offset}`);
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1; // a fill byte
      } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2; // standalone markers carry no length
      } else {
        const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) {
          return { marker, height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
        }
        offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
      }
    }
    throw new Error("no start-of-frame marker found");
  }

  // [MV]: rename the file (or the constant) and this - not production - finds out.
  test("exists where LINK_HERO_PATH says, and is a JPEG", () => {
    const bytes = readFileSync(heroFile);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  test("is a baseline JPEG, exactly 1024x512, under 300 KB", () => {
    const bytes = readFileSync(heroFile);
    const frame = readJpegFrame(bytes);
    expect(frame.marker).toBe(0xc0); // SOF0 = baseline; progressive (0xC2) is not drawn by every client
    expect({ width: frame.width, height: frame.height }).toEqual({ width: 1024, height: 512 });
    expect(bytes.length).toBeLessThanOrEqual(300 * 1024);
  });

  test("has the aspect ratio the card asks for", () => {
    const [w, h] = LINK_HERO_ASPECT.split(":").map(Number);
    expect(w / h).toBe(1024 / 512);
  });

  // vercel.json serves /assets/* as immutable for a year, and only /assets/ 404s honestly on a miss.
  test("lives under /assets/ with a versioned name", () => {
    expect(LINK_HERO_PATH).toMatch(/^\/assets\/.+-v\d+\.jpg$/);
  });

  test("linkHeroUrl is the https origin plus the path, and null for anything else", () => {
    expect(linkHeroUrl("https://equo-mu.vercel.app")).toBe("https://equo-mu.vercel.app/assets/line/link-hero-v1.jpg");
    expect(linkHeroUrl("http://localhost:14062")).toBeNull();
    expect(linkHeroUrl("")).toBeNull();
    expect(linkHeroUrl("equo-mu.vercel.app")).toBeNull();
  });
});
