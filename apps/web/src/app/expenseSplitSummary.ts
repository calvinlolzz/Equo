import type { ComposerMode } from "./expenseComposer";
import type { ComposerSplitMode } from "./expenseEditPrefill";
import type { UiDictionary } from "./i18n/dictionary";
import { UI_TEXT } from "./uiText";

export type SplitSummaryInput = {
  mode: ComposerMode;
  /** The single payer's display name. Ignored when payerCount > 1. */
  payerName: string;
  /** How many payers the draft lists — more than one means the split-payer editor is in use. */
  payerCount: number;
  /** How many people the amount is divided between. */
  shareCount: number;
  splitMode: ComposerSplitMode;
};

/**
 * The one line that stands in for the composer's 付款人 and 分帳 steps on a
 * phone: "我付 · 4 人均分".
 *
 * Those were two full screens everybody walked through to accept the values
 * that were already there — the common expense is one person paying and
 * everyone splitting it evenly. This says what those screens would have said,
 * and stays one tap away from all of it.
 *
 * Phrases come out of the dictionary whole rather than assembled from
 * fragments, because the word order does not survive translation: 「我付」 is
 * name-then-verb and "Alex paid" is the other way round.
 */
export function buildSplitSummary(
  input: SplitSummaryInput,
  words: UiDictionary["splitSummary"] = UI_TEXT.splitSummary,
): string {
  const payer =
    input.payerCount > 1
      ? words.paidByMany.replace("{n}", String(input.payerCount))
      : (input.mode === "income" ? words.collectedBy : words.paidBy).replace("{name}", input.payerName);

  if (input.shareCount === 0) return `${payer} · ${words.nobody}`;

  const split =
    input.splitMode === "amount"
      ? words.customAmount
      : input.splitMode === "percent"
        ? words.customPercent
        : words.equal.replace("{n}", String(input.shareCount));

  return `${payer} · ${split}`;
}
