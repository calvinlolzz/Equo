/**
 * Everything in the composer a user can actually change, flattened so "has
 * this sheet been touched?" is one comparison against the values it opened
 * with. Purely presentational state (which accordion is expanded, which step
 * is showing, whether a submit is in flight) is deliberately absent: stepping
 * from 金額 to 分攤 without typing anything must not count as unsaved work.
 */
export type ComposerSnapshot = {
  mode: string;
  category: string;
  dateTime: string;
  currency: string;
  exchangeRate: string;
  title: string;
  amount: string;
  payerId: string;
  transferToId: string;
  shareIds: string[];
  splitMode: string;
  shareAmounts: Record<string, string>;
  sharePercents: Record<string, string>;
  payerRows: Array<{ payerId: string; amount: string }>;
  imageDataUrls: string[];
  imageUrls: string[];
  note: string;
};

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Records of per-member input strings, compared by content rather than by
 * shape. Typing into a member's 指定金額 field and clearing it again leaves
 * the key behind with an empty value, which must still read as untouched — so
 * an absent key and an empty string are the same thing here.
 */
function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
}

function samePayerRows(a: ComposerSnapshot["payerRows"], b: ComposerSnapshot["payerRows"]): boolean {
  return (
    a.length === b.length &&
    a.every((row, index) => row.payerId === b[index].payerId && row.amount === b[index].amount)
  );
}

/**
 * Whether the composer holds work that closing would throw away.
 *
 * Compared against the snapshot the sheet opened with rather than against
 * "empty", so this answers correctly for an edit too: reopening an existing
 * expense and closing it untouched is not unsaved work, but changing one digit
 * of its amount is.
 */
export function isComposerDirty(initial: ComposerSnapshot, current: ComposerSnapshot): boolean {
  return !(
    initial.mode === current.mode &&
    initial.category === current.category &&
    initial.dateTime === current.dateTime &&
    initial.currency === current.currency &&
    initial.exchangeRate === current.exchangeRate &&
    initial.title === current.title &&
    initial.amount === current.amount &&
    initial.payerId === current.payerId &&
    initial.transferToId === current.transferToId &&
    initial.splitMode === current.splitMode &&
    initial.note === current.note &&
    sameList(initial.imageDataUrls, current.imageDataUrls) &&
    sameList(initial.imageUrls, current.imageUrls) &&
    sameList(initial.shareIds, current.shareIds) &&
    sameRecord(initial.shareAmounts, current.shareAmounts) &&
    sameRecord(initial.sharePercents, current.sharePercents) &&
    samePayerRows(initial.payerRows, current.payerRows)
  );
}
