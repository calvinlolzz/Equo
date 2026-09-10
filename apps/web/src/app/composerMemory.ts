/**
 * "What did this group use last time" — the composer's small memories.
 *
 * Per group rather than global, for the reason the currency one was written
 * that way: somebody can be in a Tokyo trip and a rent group in the same week,
 * and the right default in one is the wrong default in the other.
 *
 * Every one of these is a convenience with a correct fallback, so nothing here
 * is allowed to fail loudly — a full or blocked localStorage must not take an
 * expense down with it.
 */
type MemoryStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): MemoryStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** One `{ [groupId]: value }` map per key. Empty string means "nothing remembered". */
export function readGroupMemory(
  key: string,
  groupId: string,
  storage: MemoryStorage | null = browserStorage(),
): string {
  if (!storage || !groupId) return "";
  try {
    const raw = storage.getItem(key);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed?.[groupId];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function writeGroupMemory(
  key: string,
  groupId: string,
  value: string,
  storage: MemoryStorage | null = browserStorage(),
): void {
  if (!storage || !groupId || !value) return;
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const entries = parsed && typeof parsed === "object" ? parsed : {};
    storage.setItem(key, JSON.stringify({ ...entries, [groupId]: value }));
  } catch {
    // See the note at the top of the file.
  }
}

const LAST_CATEGORY_KEY = "equo.clean.last_category";

/**
 * The category this group's last expense was filed under.
 *
 * Every entry used to start at 一般 regardless of what the last twenty were.
 * On a trip that is 餐飲 six times a day, re-chosen six times a day — the
 * composer already knew the answer and asked anyway.
 *
 * The caller checks the remembered value against the live catalog before using
 * it: a category can be turned off in the console, and a default pointing at
 * one that no longer exists is worse than no default.
 */
export function readLastCategory(groupId: string, storage?: MemoryStorage | null): string {
  return readGroupMemory(LAST_CATEGORY_KEY, groupId, storage === undefined ? browserStorage() : storage);
}

export function writeLastCategory(groupId: string, category: string, storage?: MemoryStorage | null): void {
  writeGroupMemory(LAST_CATEGORY_KEY, groupId, category, storage === undefined ? browserStorage() : storage);
}

/**
 * The titles this group has used before, newest first, for the title field's
 * suggestion list.
 *
 * Built from the expenses already in hand rather than asked for: the group's
 * history is what the home screen is drawn from, so this costs a pass over an
 * array and no request at all.
 *
 * Capped because a <datalist> is a dropdown a person has to look at, and a
 * hundred entries is not a suggestion. Titles that are just the category label
 * are dropped — the composer writes those itself when the field is left empty
 * (see submitComposer), so suggesting them back is offering somebody their own
 * blank.
 */
export function recentExpenseTitles(
  expenses: ReadonlyArray<{ title?: string | null }>,
  categoryLabels: ReadonlySet<string>,
  limit = 20,
): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const expense of expenses) {
    const title = (expense.title ?? "").trim();
    if (!title || categoryLabels.has(title)) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= limit) break;
  }

  return titles;
}
