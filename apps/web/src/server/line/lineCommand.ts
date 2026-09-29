import { EN } from "../../app/i18n/en.js";
import { ZH_HANT } from "../../app/i18n/zhHant.js";
import { LINE_CATEGORY_KEYWORDS } from "./lineCategoryKeywords.js";

/**
 * The LINE chat command grammar: parses a normalized message into either a
 * named command (help/month/undo/unlink/link/budget), a record attempt, or an error
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
  | "title_too_long"
  | "date_not_supported"
  | "budget_invalid"
  | "budget_too_large"
  | "budget_ambiguous";

export type LineCommand =
  | { type: "help" }
  | { type: "month" }
  | { type: "undo" }
  | { type: "unlink" }
  | { type: "link" }
  | { type: "budget_show" }
  | { type: "budget_set"; amountMinor: number }
  | { type: "budget_clear" }
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

// 「預算」 commands: view, set/change, clear the personal ledger's monthly
// budget. Checked AFTER the exact-match commands above and BEFORE the record
// grammar, so 「預算 15000」 sets the budget instead of recording an expense
// titled 預算. Only a whole-message amount counts - see parseBudgetCommand.
const BUDGET_SHOW_COMMANDS = [
  "預算",
  "每月預算",
  "本月預算",
  "查看預算",
  "我的預算",
  "预算",
  "每月预算",
  "本月预算",
  "查看预算",
  "我的预算",
  "budget",
  "monthly budget",
  "my budget",
];
const BUDGET_CLEAR_COMMANDS = [
  "刪除預算",
  "清除預算",
  "取消預算",
  "移除預算",
  "刪掉預算",
  "取消每月預算",
  "删除预算",
  "清除预算",
  "取消预算",
  "budget off",
  "budget clear",
  "clear budget",
  "remove budget",
  "delete budget",
  "no budget",
];
/** Longest first, so 「預算改成」 wins over 「預算改」 wins over 「預算」. Sorted once at module load. */
const BUDGET_SET_PREFIXES_CJK = [
  "設定每月預算",
  "設定預算為",
  "設定預算",
  "修改預算",
  "更改預算",
  "每月預算",
  "本月預算",
  "我的預算",
  "月預算",
  "預算改成",
  "預算改為",
  "預算設為",
  "預算設成",
  "預算設定",
  "預算調整",
  "預算調成",
  "預算改",
  "預算",
  "设定每月预算",
  "设定预算为",
  "设定预算",
  "修改预算",
  "更改预算",
  "每月预算",
  "本月预算",
  "我的预算",
  "月预算",
  "预算改成",
  "预算改为",
  "预算设为",
  "预算设成",
  "预算设定",
  "预算调整",
  "预算调成",
  "预算改",
  "预算",
].sort((a, b) => b.length - a.length);
/** ASCII prefixes need a separator (a colon, an equals sign or a space), so 「budgeting 50」 stays a record. */
const BUDGET_SET_ASCII = /^(?:set my budget|set monthly budget|set budget|monthly budget|my budget|budget)\s*[:=\s]\s*(.+)$/;
/**
 * A record whose title is essentially just "budget" - what a near-miss
 * phrasing of the set command turns into (「預算 15000 餐飲」). Deliberately
 * NOT a loose prefix test: 「預算外」 and 「預算書」 are real expense titles.
 */
const BUDGET_TITLE_CJK =
  /^(?:設定|设定|修改|更改|調整|调整|本月|我的|每月|月)?(?:預算|预算)(?:改成|改為|改为|改|設成|设成|設為|设为|設定|设定|調整|调整|調成|调成|為|为)?$/;
const BUDGET_TITLE_ASCII = /^(?:my |monthly |set |set my |set monthly )?budget$/;

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

function trySplitToken(
  token: string,
  currency: string,
): { amount: AmountToken; titleText: string; titleAtStart: boolean } | null {
  const prefixMatch = token.match(PREFIX_SPLIT);
  if (prefixMatch) {
    const [, titlePart, amountPart] = prefixMatch;
    const parsed = parseAmountToken(amountPart, currency);
    if (parsed && !("error" in parsed)) {
      return { amount: parsed, titleText: titlePart.trim(), titleAtStart: true };
    }
  }

  const suffixMatch = token.match(SUFFIX_SPLIT);
  if (suffixMatch) {
    const [, amountPart, titlePart] = suffixMatch;
    const parsed = parseAmountToken(amountPart, currency);
    if (parsed && !("error" in parsed)) {
      return { amount: parsed, titleText: titlePart.trim(), titleAtStart: false };
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

type TitleToken = {
  /** NFKC-folded, used only to MATCH categories and keywords. */
  norm: string;
  /** What the user actually typed, used for the stored title. */
  orig: string;
};

function resolveCategory(
  titleTokens: readonly TitleToken[],
  kind: "expense" | "income",
  categories: readonly LineCategoryInfo[],
): { category: string; title: string } {
  const scopes: LineCatalogScope[] = kind === "income" ? ["income"] : ["shared", "personal"];
  const joinOrig = (tokens: readonly TitleToken[]) => tokens.map((t) => t.orig).join(" ");

  if (titleTokens.length >= 2) {
    const last = titleTokens[titleTokens.length - 1];
    const lastKey = matchCategoryToken(last.norm, scopes, categories);
    if (lastKey) return { category: lastKey, title: joinOrig(titleTokens.slice(0, -1)) };

    const first = titleTokens[0];
    const firstKey = matchCategoryToken(first.norm, scopes, categories);
    if (firstKey) return { category: firstKey, title: joinOrig(titleTokens.slice(1)) };
  } else if (titleTokens.length === 1) {
    const key = matchCategoryToken(titleTokens[0].norm, scopes, categories);
    if (key) return { category: key, title: titleTokens[0].orig };
  }

  const norms = titleTokens.map((t) => t.norm);
  const keywordKey = matchKeyword(norms.join(" "), norms, scopes, categories);
  if (keywordKey) return { category: keywordKey, title: joinOrig(titleTokens) };

  return { category: LINE_DEFAULT_CATEGORY[kind], title: joinOrig(titleTokens) };
}

/** Whether a title names something in the given scopes, by category label/key or by keyword. */
function titleHitsScopes(
  titleTokens: readonly TitleToken[],
  scopes: readonly LineCatalogScope[],
  categories: readonly LineCategoryInfo[],
): boolean {
  const norms = titleTokens.map((t) => t.norm);
  if (norms.some((n) => matchCategoryToken(n, scopes, categories))) return true;
  return matchKeyword(norms.join(" "), norms, scopes, categories) !== null;
}

/**
 * Income without an explicit marker: "薪水 50000", "salary 50000", "利息 50".
 *
 * The rule, deterministic and deliberately conservative: a message is income
 * only when its title hits the INCOME scope (an income category label/key or an
 * income keyword) AND nothing in it hits an expense category label or keyword.
 * So "利息 50 早餐" stays an expense (早餐 is food) - expense wins any tie,
 * because a wrongly-recorded income silently inflates the month's balance,
 * while a wrongly-recorded expense is the default and is caught at a glance.
 * An explicit "支出"/"expense" marker turns inference off entirely.
 */
function looksLikeIncome(titleTokens: readonly TitleToken[], categories: readonly LineCategoryInfo[]): boolean {
  return (
    titleHitsScopes(titleTokens, ["income"], categories) &&
    !titleHitsScopes(titleTokens, ["shared", "personal"], categories)
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * A token that reads as a date (9/30, 2026/9/30, 2026-09-30, 9月30日, and 9-30
 * when the day is 13 or more). LINE entries are always dated today - see
 * lineDateKey - so a date is refused with a pointer to the app rather than
 * being silently absorbed into the title.
 *
 * The two-part dash form is the one ambiguity: "7-11" is a convenience store
 * as often as July 11th, and the grammar's own table keeps it as a title. A
 * day of 13+ cannot be a store name in practice, so only then is M-D a date.
 * Slash forms are always dates.
 */
function isDateToken(token: string): boolean {
  if (/^\d{1,2}月\d{1,2}[日号]?$/.test(token)) return true;
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(token)) return true;
  if (/^\d{1,2}\/\d{1,2}$/.test(token)) return true;
  const dash = token.match(/^(\d{1,2})-(\d{1,2})$/);
  return Boolean(dash && Number(dash[1]) >= 1 && Number(dash[1]) <= 12 && Number(dash[2]) >= 13 && Number(dash[2]) <= 31);
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/**
 * The user's own spelling of the title half of a split token ("早餐６０" ->
 * "早餐"): the same number of code points, taken from the matching end of the
 * original - unless folding changed the length, in which case the folded text
 * is the best available.
 */
function originalTitlePart(token: TitleToken, foldedTitle: string, titleAtStart: boolean): string {
  const count = [...foldedTitle].length;
  const chars = [...token.orig];
  if (chars.length !== [...token.norm].length) return foldedTitle;
  return (titleAtStart ? chars.slice(0, count) : chars.slice(chars.length - count)).join("");
}

function parseRecordCommand(
  original: string,
  options: { currency: string; categories: readonly LineCategoryInfo[] },
): LineCommand {
  // Two parallel views of each token: the user's own text (for the stored
  // title) and its NFKC fold (for everything that DETECTS something - amounts,
  // markers, dates, categories). Splitting on whitespace BEFORE folding keeps
  // them one-to-one.
  let pairs: TitleToken[] = original
    .split(/\s+/)
    .filter(Boolean)
    .map((orig) => ({ orig, norm: orig.normalize("NFKC") }));

  let incomeMarker = false;
  let expenseMarker = false;
  if (pairs.length > 0) {
    const first = pairs[0].norm;
    const firstLower = first.toLowerCase();
    if (first === "收入" || firstLower === "income" || first === "+") {
      incomeMarker = true;
      pairs = pairs.slice(1);
    } else if (first === "支出" || firstLower === "expense") {
      expenseMarker = true;
      pairs = pairs.slice(1);
    }
  }

  const amounts: AmountToken[] = [];
  const amountErrors: LineCommandErrorReason[] = [];
  let titleTokens: TitleToken[] = [];
  let sawDate = false;

  for (const pair of pairs) {
    if (isDateToken(pair.norm)) {
      sawDate = true;
      continue;
    }

    // "60." / "60。" - a sentence-final stop glued to the amount.
    const stripped = pair.norm.replace(/[.。]+$/, "");
    const probe = stripped !== pair.norm && parseAmountToken(stripped, options.currency) !== null ? stripped : pair.norm;
    const result = parseAmountToken(probe, options.currency);

    if (result === null) {
      titleTokens.push(pair);
    } else if ("error" in result) {
      amountErrors.push(result.error);
    } else {
      amounts.push(result);
    }
  }

  // "早餐60": the whole message came in as one token that is neither a clean
  // amount nor a clean piece of text. Try splitting it before giving up.
  if (amounts.length === 0 && amountErrors.length === 0 && !sawDate && titleTokens.length === 1) {
    const only = titleTokens[0];
    const split = trySplitToken(only.norm, options.currency);
    if (split) {
      amounts.push(split.amount);
      titleTokens = split.titleText
        ? [{ norm: split.titleText, orig: originalTitlePart(only, split.titleText, split.titleAtStart) }]
        : [];
    }
  }

  if (sawDate) {
    return { type: "error", reason: "date_not_supported" };
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

  const rawTitle = titleTokens.map((t) => t.orig).join(" ");
  if ([...rawTitle].length > LINE_MAX_TITLE) {
    return { type: "error", reason: "title_too_long" };
  }

  const explicitIncome = incomeMarker || amount.income;
  const kind: "expense" | "income" =
    explicitIncome || (!expenseMarker && looksLikeIncome(titleTokens, options.categories)) ? "income" : "expense";
  const resolved = resolveCategory(titleTokens, kind, options.categories);
  const title = resolved.title.trim() || rawTitle.trim();

  if (title.length === 0) {
    return { type: "error", reason: "missing_title" };
  }

  return { type: "record", kind, title, amountMinor: amount.amountMinor, category: resolved.category };
}

/**
 * The budget grammar, on the folded + lowercased message. Returns null - not an
 * error - for anything that is not a whole-message budget command, so it falls
 * through to the record grammar: 「預算外 300」, 「預算外300」, 「預算書 200」
 * and 「budgeting 50」 stay records. (「預算 15000 餐飲」 also falls through, but
 * parseLineCommand's safety net then asks what was meant.)
 *
 * After a set prefix the rest must be exactly ONE amount token. An amount
 * that is present but unusable (0, negative, a leading +, too many decimals)
 * is `budget_invalid`, and too large is `budget_too_large` - never a clear:
 * clearing needs explicit words
 * (「取消預算」), and 「預算 0」 must not silently destroy a budget.
 */
export function parseBudgetCommand(lower: string, currency: string): LineCommand | null {
  // 「預算？」 - a trailing question mark still means "show me".
  if (BUDGET_SHOW_COMMANDS.includes(lower.replace(/\s*\?+$/, ""))) return { type: "budget_show" };
  if (BUDGET_CLEAR_COMMANDS.includes(lower)) return { type: "budget_clear" };

  let rest: string | null = null;
  const cjkPrefix = BUDGET_SET_PREFIXES_CJK.find((prefix) => lower.startsWith(prefix));
  if (cjkPrefix) {
    rest = lower
      .slice(cjkPrefix.length)
      // "預算：15000" / "預算=15000" / "預算 15000"
      .replace(/^\s*[:=]?\s*/, "")
      // "預算 改成 20000" - a change verb after a space
      .replace(/^(?:改成|改為|改为|改)\s*[:=]?\s*/, "");
  } else {
    const ascii = lower.match(BUDGET_SET_ASCII);
    if (ascii) rest = ascii[1];
  }

  if (rest === null || rest === "") return null;

  // "15000 元" / "NT$ 15000" - a space between the amount and its unit.
  rest = rest.replace(/^(nt\$|\$)\s+/, "$1").replace(/\s+(元|塊錢|塊)$/, "$1");

  // "15000." / "15000。" - a sentence-final stop glued to the amount.
  const stripped = rest.replace(/[.。]+$/, "");
  if (stripped === "") return null;

  // The rest must be exactly ONE amount token: parseAmountToken's patterns
  // are anchored and allow no whitespace, so 「預算 15000 餐飲」 and 「預算書
  // 200」 come back null here and fall through to the record grammar.
  const result = parseAmountToken(stripped, currency);
  if (result === null) return null;
  if ("error" in result) {
    if (result.error === "no_decimals") return { type: "error", reason: "no_decimals" };
    if (result.error === "too_large") return { type: "error", reason: "budget_too_large" };
    return { type: "error", reason: "budget_invalid" };
  }
  if (result.income) return { type: "error", reason: "budget_invalid" };

  return { type: "budget_set", amountMinor: result.amountMinor };
}

/** Whether a record's title is essentially just "budget" - see BUDGET_TITLE_CJK. */
function looksLikeBudgetTitle(title: string): boolean {
  const folded = title.normalize("NFKC").toLowerCase().trim();
  return BUDGET_TITLE_CJK.test(folded) || BUDGET_TITLE_ASCII.test(folded);
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

  const budget = parseBudgetCommand(lower, options.currency);
  if (budget) return budget;

  const record = parseRecordCommand(originalForRecord(text), options);

  // Safety net: a near-miss budget phrasing we did not recognise must not
  // silently become a big expense titled "預算". Ask instead.
  if (record.type === "record" && looksLikeBudgetTitle(record.title)) {
    return { type: "error", reason: "budget_ambiguous" };
  }

  return record;
}

/** The user's text for the record path: whitespace-collapsed, trimmed, trailing sentence punctuation dropped - but NOT folded, so the stored title stays as typed. */
function originalForRecord(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(TRAILING_PUNCTUATION, "").trim();
}
