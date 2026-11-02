/**
 * A Storage that lives and dies with the page.
 *
 * For the places that normally write to localStorage but must not in LIFF mode
 * (the cloud cache and the offline write queue - see appChrome.localSession):
 * handing them this instead means "same code, nothing persisted", with no
 * second code path to keep in step.
 */
export type MemoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createMemoryStorage(): MemoryStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}
