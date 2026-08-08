import { useCallback, useEffect, useRef, useState } from "react";
import type { RecurringExpense, RecurringExpenseInput } from "./apiClient";

type Store = {
  listRecurring: (groupId: string) => Promise<RecurringExpense[]>;
  upsertRecurring: (groupId: string, payload: RecurringExpenseInput) => Promise<RecurringExpense>;
  deleteRecurring: (groupId: string, id: string) => Promise<void>;
};

type Options = {
  store: Store | null;
  groupId: string | null;
  /** False while the 循環支出 panel is closed. */
  enabled: boolean;
  showToast: (message: string) => void;
  describeError: (error: unknown) => string;
};

/**
 * The 循環支出 rules for one group, loaded when the panel opens.
 *
 * Writes re-read the list rather than patching it locally: the server decides
 * next_run_date (editing the day reschedules, editing the amount deliberately
 * does not), so a locally-patched row would show a date the server disagrees
 * with until the next open.
 */
export function useRecurringExpenses({ store, groupId, enabled, showToast, describeError }: Options) {
  const [rules, setRules] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const requestId = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled || !groupId || !store) return;

    const token = ++requestId.current;
    setLoading(true);
    setError(null);

    store
      .listRecurring(groupId)
      .then((result) => {
        if (token !== requestId.current) return;
        setRules(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (token !== requestId.current) return;
        setError(describeError(cause));
        setLoading(false);
      });
    // describeError is a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, groupId, store, reloadToken]);

  useEffect(() => {
    if (enabled) return;
    requestId.current += 1;
    setRules([]);
    setError(null);
    setLoading(false);
    setSavingId(null);
  }, [enabled]);

  const save = useCallback(
    async (input: RecurringExpenseInput) => {
      if (!store || !groupId) return false;
      setSavingId("save");
      try {
        await store.upsertRecurring(groupId, input);
        setRules(await store.listRecurring(groupId));
        showToast(input.id ? "已更新循環支出" : "已建立循環支出");
        return true;
      } catch (cause) {
        showToast(describeError(cause));
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [store, groupId, showToast, describeError],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!store || !groupId) return;
      setSavingId(id);
      try {
        await store.deleteRecurring(groupId, id);
        // Drop it locally too: a re-list would be a second round trip to learn
        // something we already know.
        setRules((current) => current.filter((rule) => rule.id !== id));
        showToast("已刪除循環支出");
      } catch (cause) {
        showToast(describeError(cause));
      } finally {
        setSavingId(null);
      }
    },
    [store, groupId, showToast, describeError],
  );

  const retry = useCallback(() => setReloadToken((value) => value + 1), []);

  return { rules, loading, error, savingId, save, remove, retry };
}
