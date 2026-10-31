import { EN } from "../../app/i18n/en.js";
import { ZH_HANT } from "../../app/i18n/zhHant.js";
import type { FlexAspectRatio, FlexTextSize } from "./lineFlex.js";

/**
 * How a LINE card looks, apart from its layout: the palette, the budget
 * thresholds, the category emoji and the little colour maths. Pure data and
 * pure functions, so each can be pinned by a test.
 *
 * app/catalog.ts is NOT importable from here: it pulls in ./uiText without a
 * `.js` extension, which resolves under Vite/Vitest and breaks native Node ESM
 * the moment server code reaches it (see lineCommand.ts's header and
 * scripts/check-api-esm-imports.py). The one thing it would give this file,
 * its fallback category colour, is duplicated below and pinned equal to the
 * original by lineCardTheme.test.ts. en.ts has no such import and is safe.
 */

/**
 * Flex has no notion of LINE's light and dark themes - explicit colours render
 * the same in both - so a card is dark everywhere and its colours must work
 * on that one background. Contrast of every text colour on `bg` and `raised`
 * is pinned at 4.5:1 or better by the tests.
 *
 * `buttonBg` is not mint on purpose: LINE always draws a primary button's
 * label white, and white on mint is 1.63:1. Mint stays for text and accents.
 */
export const CARD = {
  bg: "#12151F",
  raised: "#1A1F2E",
  hairline: "#262C3F",
  text: "#EEF1F6",
  muted: "#9AA3B5",
  mint: "#4DE3A6",
  amber: "#FFB84D",
  coral: "#FF6B6B",
  blue: "#6EA8FF",
  violet: "#BEA0FF",
  buttonBg: "#0E8460",
} as const;

/** Colour for a category the catalog does not know - a copy of catalog.ts's FALLBACK_CATEGORY_COLOR. */
export const CATEGORY_FALLBACK_COLOR = "#93A0B5";

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

/**
 * A category colour that is safe to put in a card. Catalog colours are
 * admin-edited free text, and LINE rejects the whole message for a colour it
 * cannot parse ("red", "#12345"), so anything that is not #RGB or #RRGGBB
 * becomes `fallback`. #RRGGBBAA is refused too: tints are precomputed as
 * opaque colours (see tint) rather than sent with alpha.
 */
export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (HEX6.test(value)) return value.toUpperCase();
  if (HEX3.test(value)) {
    const [r, g, b] = value.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

/**
 * `fg` laid over `bg` at opacity `alpha`, as an opaque #RRGGBB. Both colours
 * must already be #RRGGBB - normalizeHexColor's output or a CARD colour.
 */
export function mixHex(fg: string, bg: string, alpha: number): string {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  const over = channels(fg);
  const under = channels(bg);
  const mixed = over.map((channel, index) => Math.round(channel * a + under[index] * (1 - a)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** The soft background behind an emoji tile: the accent at 22% over the card. */
export function tint(color: string): string {
  return mixHex(color, CARD.bg, 0.22);
}

export type BudgetTone = "ok" | "warn" | "over";

/**
 * Where spending stands against the budget, in integer maths so the 80% and
 * 100% lines are exact: below 80% is "ok", 80% up to and including 100% is
 * "warn", beyond it is "over". Callers only ask when there is a budget.
 */
export function budgetTone(spent: number, budget: number): BudgetTone {
  if (spent * 100 < budget * 80) return "ok";
  if (spent <= budget) return "warn";
  return "over";
}

export function toneColor(tone: BudgetTone): string {
  if (tone === "ok") return CARD.mint;
  if (tone === "warn") return CARD.amber;
  return CARD.coral;
}

/**
 * How full a bar is, 0-100. Anything above 0 shows at least a 1% sliver,
 * because a bar with a small amount in it must not look like an empty one, and
 * only a value that reaches `max` shows as full - flooring means 99.9% reads
 * 99, never 100.
 */
export function barPercent(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  if (value >= max) return 100;
  return Math.max(1, Math.floor((value * 100) / max));
}

/** The "已用 N%" figure, not clamped: 500% of a budget is worth saying. 0 when there is no budget to divide by. */
export function usedPercent(spent: number, budget: number): number {
  if (!(budget > 0) || !Number.isFinite(spent)) return 0;
  return Math.floor((spent * 100) / budget);
}

/** The headline amount shrinks as it gets longer so "$1,000,000,000" does not overflow the card. Counts code points. */
export function amountTextSize(amount: string): FlexTextSize {
  const length = [...amount].length;
  if (length <= 10) return "3xl";
  if (length <= 14) return "xxl";
  return "xl";
}

/**
 * One emoji per catalog category, written as escapes so the code point is in
 * the source and not at the mercy of an editor. Each is a single code point
 * with Emoji_Presentation=Yes and nothing newer than Unicode 9: a variation
 * selector (U+FE0F) or a ZWJ sequence draws as text or as several emoji on
 * some clients, and a newer emoji is tofu on an older LINE desktop. That is why
 * there is no shopping-bags, fork-and-knife, pencil or back arrow here -
 * every one of those needs a U+FE0F. lineCardTheme.test.ts checks both the
 * property and that every DEFAULT_CATALOG key is covered.
 */
export const LINE_CATEGORY_EMOJI: Readonly<Record<string, string>> = {
  food: "\u{1F371}",
  transport: "\u{1F687}",
  lodging: "\u{1F3E8}",
  shopping: "\u{1F6D2}",
  general: "\u{1F4DD}",
  other: "\u{1F4E6}",
  entertainment: "\u{1F3AC}",
  home: "\u{1F3E0}",
  bills: "\u{1F4A1}",
  health: "\u{1F48A}",
  education: "\u{1F4DA}",
  salary: "\u{1F4B0}",
  bonus: "\u{1F381}",
  investment: "\u{1F4C8}",
  other_income: "\u{1F4B5}",
};

/** For a category key nobody gave an emoji - a bookmark. */
const FALLBACK_EMOJI = "\u{1F516}";

export function categoryEmoji(key: string): string {
  // An own-property check: a category key is data, and "constructor" must not come back as a function.
  return Object.hasOwn(LINE_CATEGORY_EMOJI, key) ? LINE_CATEGORY_EMOJI[key] : FALLBACK_EMOJI;
}

/**
 * The link card's hero image. vercel.json serves /assets/* with a year-long
 * `immutable` cache, so the filename carries a version: a new picture is a new
 * -vN file, never an overwrite. It must also stay under /assets/ - a missing
 * file anywhere else falls into the SPA rewrite and answers 200 text/html,
 * while a missing /assets/ file is an honest 404.
 */
export const LINK_HERO_PATH = "/assets/line/link-hero-v1.jpg";
export const LINK_HERO_ASPECT: FlexAspectRatio = "2:1";

/** LINE only fetches images over https, so an http origin (local dev) gets a card without a hero. */
export function linkHeroUrl(origin: string): string | null {
  return origin.startsWith("https://") ? `${origin}${LINK_HERO_PATH}` : null;
}

export type LineCategoryDisplay = { key: string; label: string; color: string; emoji: string };

/**
 * A category as a card shows it. The label rules are the ones the plain-text
 * replies always used: zh shows the live catalog's label (an admin may have
 * renamed it), then the app's built-in Chinese name (the catalog only lists
 * enabled categories), then the key; en shows the app's own English label
 * and falls back to the catalog's for a category the bundle has never heard of.
 * The colour is normalized (admin input) and the emoji falls back to a bookmark.
 */
export function categoryDisplay(
  key: string,
  categories: ReadonlyArray<{ key: string; label: string; color: string }>,
  locale: string,
): LineCategoryDisplay {
  const entry = categories.find((category) => category.key === key);
  // line_context only returns the ENABLED categories, but a ledger still holds spending on one an admin has
  // since disabled; the app names it from its built-in table (catalog.ts categoryLabel), so a card does too.
  const builtInLabel = Object.hasOwn(ZH_HANT.categories, key) ? (ZH_HANT.categories as Record<string, string>)[key] : undefined;
  const catalogLabel = entry?.label ?? builtInLabel ?? key;
  // Own-property check for the same reason as categoryEmoji: the key can be any string a ledger holds.
  const englishLabel = Object.hasOwn(EN.categories, key) ? (EN.categories as Record<string, string>)[key] : undefined;

  return {
    key,
    label: locale === "en" ? (englishLabel ?? catalogLabel) : catalogLabel,
    color: normalizeHexColor(entry?.color, CATEGORY_FALLBACK_COLOR),
    emoji: categoryEmoji(key),
  };
}
