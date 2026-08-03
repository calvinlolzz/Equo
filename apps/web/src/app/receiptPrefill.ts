import type { ScanReceiptResponse } from "../contracts/schemas";
import type { ExpenseEditPrefill } from "./expenseEditPrefill";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/** What a finished receipt scan hands the composer. The photo is always present; everything else may not be. */
export type ReceiptPrefill = {
  /** The captured jpeg. Attached to the expense whether or not recognition worked. */
  imageDataUrl: string;
  /** null when recognition was unavailable or the photo wasn't a readable receipt. */
  scan: ScanReceiptResponse | null;
};

type PrefillContext = {
  groupCurrency: string;
  /** Currency codes the composer's picker offers. A scanned code outside it can't be selected. */
  currencyCodes: readonly string[];
  memberIds: string[];
  nowIso: string;
};

function minorToAmountString(amountMinor: number): string {
  return (Math.round(amountMinor) / 100).toString();
}

/**
 * Keeps the receipt's own date but not its time: the printed date is the one
 * fact worth carrying over (it decides which month's total the expense lands
 * in), while receipts rarely print a time and inventing midnight would order
 * the day's entries wrongly. So the day comes from the receipt and the
 * time-of-day from now.
 */
function mergeReceiptDate(purchasedAt: string | null, nowIso: string): string {
  if (!purchasedAt) return nowIso;
  const now = new Date(nowIso);
  const merged = new Date(`${purchasedAt}T00:00:00`);
  if (Number.isNaN(merged.getTime())) return nowIso;
  merged.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return merged.toISOString();
}

/**
 * Seed the composer from a scan.
 *
 * Everything the model was unsure about stays empty rather than being filled
 * with a plausible default — a blank amount field is an obvious prompt to type
 * one, whereas a wrong amount that looks confident is what silently corrupts a
 * shared ledger. The split is the composer's usual "everyone, evenly", because
 * that is the answer for the overwhelming majority of receipts and is one tap
 * to change.
 */
export function buildReceiptComposerPrefill(
  prefill: ReceiptPrefill,
  { groupCurrency, currencyCodes, memberIds, nowIso }: PrefillContext,
): ExpenseEditPrefill {
  const scan = prefill.scan?.recognised ? prefill.scan : null;
  // A currency the picker can't show would leave the field displaying one code
  // while the amount means another.
  const currency = scan?.currency && currencyCodes.includes(scan.currency) ? scan.currency : groupCurrency;

  return {
    mode: "expense",
    title: scan?.merchant ?? "",
    category: scan?.category ?? "general",
    currency,
    amount: scan?.amount_minor ? minorToAmountString(scan.amount_minor) : "",
    // Left at 1 deliberately: the composer refreshes the rate from today's
    // published rates for anything that is not an edit, and a stale 1 would be
    // silently wrong for a foreign receipt.
    exchangeRate: "1",
    payerId: memberIds[0] ?? "",
    shareMemberIds: memberIds,
    splitMode: "equal",
    shareAmounts: {},
    sharePercents: {},
    payments: [],
    transferToMemberId: "",
    imageUrl: "",
    note: buildItemNote(scan),
    dateTimeIso: mergeReceiptDate(scan?.purchased_at ?? null, nowIso),
  };
}

/**
 * Line items go in the note, not into separate expenses.
 *
 * Splitting a receipt into one expense per item is a different feature with its
 * own UI (who had the beer, who had the salad); dropping the items entirely
 * would throw away the part of the scan people most want to eyeball when the
 * total looks off. The note is where that detail is both preserved and ignorable.
 */
function buildItemNote(scan: ScanReceiptResponse | null): string {
  if (!scan || scan.items.length === 0) return "";
  const lines = scan.items.map((item) =>
    item.amount_minor === null ? item.name : `${item.name} ${minorToAmountString(item.amount_minor)}`,
  );
  return `${text.scanReceipt}\n${lines.join("\n")}`;
}
