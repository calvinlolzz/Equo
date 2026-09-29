import { EN } from "../../app/i18n/en.js";
import { ZH_HANT } from "../../app/i18n/zhHant.js";
import { LINE_CATEGORY_KEYWORDS } from "./lineCategoryKeywords.js";

/**
 * The LINE chat command grammar: parses a normalized message into either a
 * named command (help/month/undo/unlink/link), a record attempt, or an error
 * reason the reply text can explain.
 *
 * Pure and synchronous by design - nothing here touches the database or the
 * network, so the whole grammar is testable as a table (see
 * lineCommand.test.ts) without a fake Postgres or a fake LINE client.
 *
 * catalog.ts is NOT importable from here: it pulls in ./uiText without a
 * `.js` extension, which resolves fine under Vite/Vitest but breaks native
 * Node ESM the moment a server module reaches it (see
 * scripts/check-api-esm-imports.py's own header comment, and the "Node ESM
 * .js extensions" trap this whole feature has to route around). So category
 * resolution talks to two things instead: whatever catalog the caller passes
 * in (line_context's categories, sourced from app_catalog()), and
 * LINE_FALLBACK_CATEGORIES below, a small mirror of catalog.ts's
 * DEFAULT_CATALOG built from data (ZH_HANT.categories) that IS safe to import
 * (zhHant.ts has no extensionless imports of its own).
 */

export type LineCatalogScope = "shared" | "personal" | "income";

export type LineCategoryInfo = {
  key: string;
  label: string;
  scope: string;
};

export type LineCommandErrorReason =
  | "not_understood"
  | "invalid_amount"
  | "no_decimals"
  | "too_large"
  | "missing_title"
  | "multiple_amounts"
  | "title_too_long";

export type LineCommand =
  | { type: "help" }
  | { type: "month" }
  | { type: "undo" }
  | { type: "unlink" }
  | { type: "link" }
  | { type: "record"; kind: "expense" | "income"; title: string; amountMinor: number; category: string }
  | { type: "error"; reason: LineCommandErrorReason };

/** The category a record falls back to when nothing else matches, per kind. Mirrors app/catalog.ts's defaultCategoryKey for {personal:true}. */
export const LINE_DEFAULT_CATEGORY: Record<"expense" | "income", string> = {
  expense: "general",
  income: "other_income",
};

export const LINE_MAX_TITLE = 60;
export const LINE_MAX_AMOUNT_MINOR = 1_000_000_000;
export const LINE_MAX_MESSAGE_LENGTH = 200;

/** Currencies the app stores with no minor-unit decimals - see app/catalog.ts and formatAmount.ts. */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(["JPY", "KRW"]);

/**
 * Mirrors app/catalog.ts's DEFAULT_CATALOG (categories, catalog.ts:67-90):
 * same keys, same scopes. Built from ZH_HANT.categories (the label source)
 * plus this hand-kept scope map, so a category catalog.ts adds later has to
 * be added here too - lineCommand.test.ts pins the two lists equal.
 */
const CATALOG_SCOPE_MAP: Record<string, LineCatalogScope> = {
  food: "shared",
  transport: "shared",
  lodging: "shared",
  shopping: "shared",
  general: "shared",
  other: "shared",
  entertainment: "personal",
  home: "personal",
  bills: "personal",
  health: "personal",
  education: "personal",
  salary: "income",
  bonus: "income",
  investment: "income",
  other_income: "income",
};

export type LineFallbackCategory = { key: string; label: string; scope: LineCatalogScope };

export const LINE_FALLBACK_CATEGORIES: readonly LineFallbackCategory[] = Object.entries(
  ZH_HANT.categories as Record<string, string>,
).map(([key, label]) => ({ key, label, scope: CATALOG_SCOPE_MAP[key] ?? "shared" }));

// ---------------------------------------------------------------------------
// Normalizing input
// ---------------------------------------------------------------------------

const TRAILING_PUNCTUATION = /[。!！~～]+$/u;

/**
 * NFKC folds full-width digits/punctuation (６０ -> 60, ＋ -> +, ， -> ,,
 * ． -> .) to their ASCII forms, which is what lets a phone's full-width IME
 * input parse the same as half-width typing.
 */
export function normalizeLineText(text: string): string {
  const folded = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  return folded.replace(TRAILING_PUNCTUATION, "").trim();
}

// ---------------------------------------------------------------------------
// Exact-match commands, checked before anything else.
// ---------------------------------------------------------------------------

const HELP_COMMANDS = ["說明", "幫助", "指令", "说明", "help", "?"];
const MONTH_COMMANDS = ["本月", "這個月", "這月", "月報", "本月统计", "month", "this month"];
const UNDO_COMMANDS = ["復原", "刪除上一筆", "刪掉上一筆", "取消上一筆", "撤銷", "复原", "删除上一笔", "undo"];
const UNLINK_COMMANDS = ["解除綁定", "解除連結", "取消綁定", "解除绑定", "unlink"];
const LINK_COMMANDS = ["綁定", "連結", "連結帳號", "綁定帳號", "绑定", "link"];

// ---------------------------------------------------------------------------
// Amount tokens
// ---------------------------------------------------------------------------

const STRICT_AMOUNT_TOKEN = /^(\+)?(?:NT\$|\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:元|塊錢|塊)?$/i;

/**
 * A broader "this was an attempt at an amount" check, used only to decide
 * whether a token that FAILS the strict pattern above is an error
 * (invalid_amount) or just ordinary title text. `-60`, `1,2,3` and `60.5.3`
 * all match this and fail the strict pattern above, so they are errors; `7-11`
 * never matches this at all (the dash sits between two digit runs, not at the
 * very start), so it is plain text.
 */
const LOOSE_AMOUNT_LIKE = /^[+-]?(?:NT\$|\$)?[\d,]+(?:\.[\d.]*)?(?:元|塊錢|塊)?$/i;

const AMOUNT_CORE_SOURCE = "(?:\\+)?(?:NT\\$|\\$)?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(?:\\d+))?(?:元|塊錢|塊)?";
const PREFIX_SPLIT = new RegExp(`^(\\D+?)(${AMOUNT_CORE_SOURCE})$`, "i");
const SUFFIX_SPLIT = new RegExp(`^(${AMOUNT_CORE_SOURCE})(\\D.*)$`, "i");

export type AmountToken = { amountMinor: number; income: boolean };
export type AmountTokenResult = AmountToken | { error: LineCommandErrorReason } | null;

/**
 * Parses one whitespace-delimited token as an amount, or says why it looks
 * like a broken attempt at one, or says it isn't one at all (null - plain
 * title text).
 */
export function parseAmountToken(token: string, currency: string): AmountTokenResult {
  const strict = token.match(STRICT_AMOUNT_TOKEN);

  if (strict) {
    const [, plus, intPart, decimalPart] = strict;

    if (decimalPart && decimalPart.length > 2) {
      return { error: "invalid_amount" };
    }

    if (decimalPart && ZERO_DECIMAL_CURRENCIES.has(currency)) {
      return { error: "no_decimals" };
    }

    const digits = intPart.replace(/,/g, "");
    const fraction = (decimalPart ?? "").padEnd(2, "0").slice(0, 2);
    const amountMinor = Number(digits) * 100 + Number(fraction);

    if (amountMinor === 0) {
      return { error: "invalid_amount" };
    }

    if (amountMinor > LINE_MAX_AMOUNT_MINOR) {
      return { error: "too_large" };
    }

    return { amountMinor, income: Boolean(plus) };
  }

  if (LOOSE_AMOUNT_LIKE.test(token)) {
    return { error: "invalid_amount" };
  }

  return null;
}

function trySplitToken(token: string, currency: string): { amount: AmountToken; titleText: string } | null {
  const prefixMatch = token.match(PREFIX_SPLIT);
  if (prefixMatch) {
    const [, titlePart, amountPart] = prefixMatch;
    const parsed = parseAmountToken(amountPart, currency);
    if (parsed && !("error" in parsed)) {
      return { amount: parsed, titleText: titlePart.trim() };
    }
  }

  const suffixMatch = token.match(SUFFIX_SPLIT);
  if (suffixMatch) {
    const [, amountPart, titlePart] = suffixMatch;
    const parsed = parseAmountToken(amountPart, currency);
    if (parsed && !("error" in parsed)) {
      return { amount: parsed, titleText: titlePart.trim() };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Category resolution
// ---------------------------------------------------------------------------

/** Every key this message is allowed to resolve to, merging the live catalog with the bundled fallback (the live one wins on a clash). */
function scopeOfKey(key: string, categories: readonly LineCategoryInfo[]): LineCatalogScope | undefined {
  const live = categories.find((c) => c.key === key);
  if (live) return live.scope as LineCatalogScope;
  return LINE_FALLBACK_CATEGORIES.find((c) => c.key === key)?.scope;
}

function allowedKeys(categories: readonly LineCategoryInfo[]): Map<string, LineCatalogScope> {
  const keys = new Map<string, LineCatalogScope>();
  for (const c of categories) keys.set(c.key, c.scope as LineCatalogScope);
  for (const c of LINE_FALLBACK_CATEGORIES) if (!keys.has(c.key)) keys.set(c.key, c.scope);
  return keys;
}

/**
 * Whether a single token names a category - by key, by the live catalog's
 * label, or by either bundled dictionary's label - restricted to the scopes
 * this kind of entry may use.
 */
function matchCategoryToken(
  token: string,
  scopes: readonly LineCatalogScope[],
  categories: readonly LineCategoryInfo[],
): string | null {
  const tokenLower = token.toLowerCase();
  const keys = allowedKeys(categories);

  for (const [key, scope] of keys) {
    if (scopes.includes(scope) && key.toLowerCase() === tokenLower) return key;
  }

  for (const c of categories) {
    if (scopes.includes(c.scope as LineCatalogScope) && c.label.toLowerCase() === tokenLower) return c.key;
  }

  const zh = ZH_HANT.categories as Record<string, string>;
  const en = EN.categories as Record<string, string>;
  for (const [key, scope] of keys) {
    if (!scopes.includes(scope)) continue;
    if (zh[key]?.toLowerCase() === tokenLower) return key;
    if (en[key]?.toLowerCase() === tokenLower) return key;
  }

  return null;
}

function matchKeyword(
  titleText: string,
  titleTokens: readonly string[],
  scopes: readonly LineCatalogScope[],
  categories: readonly LineCategoryInfo[],
): string | null {
  for (const entry of LINE_CATEGORY_KEYWORDS) {
    const scope = scopeOfKey(entry.key, categories);
    if (!scope || !scopes.includes(scope)) continue;

    for (const word of entry.words) {
      const isAscii = /^[a-z]+$/i.test(word);
      if (isAscii) {
        if (titleTokens.some((t) => t.toLowerCase() === word.toLowerCase())) return entry.key;
      } else if (titleText.includes(word)) {
        return entry.key;
      }
    }
  }

  return null;
}

function resolveCategory(
  titleTokens: readonly string[],
  kind: "expense" | "income",
  categories: readonly LineCategoryInfo[],
): { category: string; title: string } {
  const scopes: LineCatalogScope[] = kind === "income" ? ["income"] : ["shared", "personal"];

  if (titleTokens.length >= 2) {
    const last = titleTokens[titleTokens.length - 1];
    const lastKey = matchCategoryToken(last, scopes, categories);
    if (lastKey) return { category: lastKey, title: titleTokens.slice(0, -1).join(" ") };

    const first = titleTokens[0];
    const firstKey = matchCategoryToken(first, scopes, categories);
    if (firstKey) return { category: firstKey, title: titleTokens.slice(1).join(" ") };
  } else if (titleTokens.length === 1) {
    const key = matchCategoryToken(titleTokens[0], scopes, categories);
    if (key) return { category: key, title: titleTokens[0] };
  }

  const titleText = titleTokens.join(" ");
  const keywordKey = matchKeyword(titleText, titleTokens, scopes, categories);
  if (keywordKey) return { category: keywordKey, title: titleText };

  return { category: LINE_DEFAULT_CATEGORY[kind], title: titleText };
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

function parseRecordCommand(
  normalized: string,
  options: { currency: string; categories: readonly LineCategoryInfo[] },
): LineCommand {
  let tokens = normalized.split(" ").filter(Boolean);

  let incomeMarker = false;
  if (tokens.length > 0) {
    const first = tokens[0];
    const firstLower = first.toLowerCase();
    if (first === "收入" || firstLower === "income" || first === "+") {
      incomeMarker = true;
      tokens = tokens.slice(1);
    } else if (first === "支出" || firstLower === "expense") {
      tokens = tokens.slice(1);
    }
  }

  const amounts: AmountToken[] = [];
  const amountErrors: LineCommandErrorReason[] = [];
  let titleTokens: string[] = [];

  for (const token of tokens) {
    const result = parseAmountToken(token, options.currency);
    if (result === null) {
      titleTokens.push(token);
    } else if ("error" in result) {
      amountErrors.push(result.error);
    } else {
      amounts.push(result);
    }
  }

  // "早餐60": the whole message came in as one token that is neither a clean
  // amount nor a clean piece of text. Try splitting it before giving up.
  if (amounts.length === 0 && amountErrors.length === 0 && titleTokens.length === 1) {
    const split = trySplitToken(titleTokens[0], options.currency);
    if (split) {
      amounts.push(split.amount);
      titleTokens = split.titleText ? [split.titleText] : [];
    }
  }

  if (amounts.length > 1) {
    return { type: "error", reason: "multiple_amounts" };
  }

  if (amountErrors.length > 0) {
    return { type: "error", reason: amountErrors[0] };
  }

  if (amounts.length === 0) {
    return { type: "error", reason: "not_understood" };
  }

  const amount = amounts[0];

  if (titleTokens.length === 0) {
    return { type: "error", reason: "missing_title" };
  }

  const rawTitle = titleTokens.join(" ");
  if ([...rawTitle].length > LINE_MAX_TITLE) {
    return { type: "error", reason: "title_too_long" };
  }

  const kind: "expense" | "income" = incomeMarker || amount.income ? "income" : "expense";
  const resolved = resolveCategory(titleTokens, kind, options.categories);
  const title = resolved.title || rawTitle;

  if (title.length === 0) {
    return { type: "error", reason: "missing_title" };
  }

  return { type: "record", kind, title, amountMinor: amount.amountMinor, category: resolved.category };
}

export function parseLineCommand(
  text: string,
  options: { currency: string; categories: readonly LineCategoryInfo[] },
): LineCommand {
  const normalized = normalizeLineText(text);

  if (!normalized || normalized.length > LINE_MAX_MESSAGE_LENGTH) {
    return { type: "error", reason: "not_understood" };
  }

  const lower = normalized.toLowerCase();
  if (HELP_COMMANDS.includes(lower)) return { type: "help" };
  if (MONTH_COMMANDS.includes(lower)) return { type: "month" };
  if (UNDO_COMMANDS.includes(lower)) return { type: "undo" };
  if (UNLINK_COMMANDS.includes(lower)) return { type: "unlink" };
  if (LINK_COMMANDS.includes(lower)) return { type: "link" };

  return parseRecordCommand(normalized, options);
}
