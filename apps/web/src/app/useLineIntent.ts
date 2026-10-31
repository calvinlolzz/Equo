import { useEffect, useRef, useState } from "react";
import type { EquoApiClient } from "./apiClient";
import type { DialogMode, Expense, Group } from "./appTypes";
import { toExpense } from "./cloudAdapters";
import { clearLineIntentParams, readLineIntent, takeStashedLineIntent, type LineIntent } from "./lineIntent";
import type { StoredSession } from "./sessionStore";
import { UI_TEXT } from "./uiText";
import type { RouteMode } from "./useGroupRoute";

const text = UI_TEXT.app;

export type UseLineIntentOptions = {
  session: StoredSession | null;
  activeGroupId: string;
  activeGroup: Group | null;
  expenses: Expense[];
  /** The open group's detail has arrived, so `expenses` is its real list rather than the empty placeholder. */
  detailLoaded: boolean;
  openGroup: (groupId: string, mode?: RouteMode) => void;
  setDialog: (mode: DialogMode) => void;
  openExpenseEdit: (expense: Expense) => void;
  showToast: (message: string) => void;
  api: Pick<EquoApiClient, "resolveLineEntry" | "searchExpenses">;
};

/** An entry the server says is live, on its way to the edit composer. */
type EntryTarget = { groupId: string; expenseId: string; expenseDate: string };

/**
 * Acts on a link from the LINE bot: `?view=records` and `?view=analysis` open
 * those sheets, `?entry=<key>` opens that entry's edit composer.
 *
 * The intent is captured once, when the app starts (from the URL, or from the
 * stash a Google login left behind - see lineIntent.ts), and consumed at most
 * once: the first moment it can be acted on, the ref is emptied and the
 * parameters leave the address bar, so neither a re-render nor a reload nor a
 * Back can replay it.
 *
 * Nothing here is an overlay of its own. The records and analysis sheets are
 * `dialog` modes and the composer is the composer, each already registered
 * with useOverlayHistory in App.tsx, so Back closes them rather than leaving.
 * Under view-as the entry lookup is an ordinary GET for the viewed user and
 * the composer opens like any other; saving is refused by the server.
 */
export function useLineIntent(options: UseLineIntentOptions): void {
  const { session, activeGroupId, activeGroup, expenses, detailLoaded } = options;
  const intentRef = useRef<LineIntent | null>(readLineIntent(window.location.search));
  const [target, setTarget] = useState<EntryTarget | null>(null);
  const switchedForRef = useRef<EntryTarget | null>(null);

  // The callbacks are re-created on every App render. The async continuations
  // below must reach the newest ones, not the ones from the render that
  // started them.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // The stash is read in an effect, not while rendering: reading consumes it,
  // and a render may run twice. The URL wins; the stash is dropped either way.
  useEffect(() => {
    const stashed = takeStashedLineIntent();
    if (!intentRef.current) intentRef.current = stashed;
  }, []);

  useEffect(() => {
    const intent = intentRef.current;
    if (!session || !activeGroup || !intent || intent.kind === "entry") return;

    intentRef.current = null;
    clearLineIntentParams();
    latest.current.setDialog(intent.kind === "records" ? "recordsPanel" : "analysisPanel");
  }, [session, activeGroup]);

  useEffect(() => {
    const intent = intentRef.current;
    if (!session || !intent || intent.kind !== "entry") return;

    intentRef.current = null;
    clearLineIntentParams();

    latest.current.api
      .resolveLineEntry(intent.entryKey)
      .then((resolution) => {
        if (resolution.status === "live") {
          setTarget({
            groupId: resolution.group_id,
            expenseId: resolution.expense_id,
            expenseDate: resolution.expense_date,
          });
        } else {
          latest.current.showToast(resolution.status === "gone" ? text.lineEntryGone : text.lineEntryNotFound);
        }
      })
      .catch(() => latest.current.showToast(text.lineEntryFailed));
  }, [session]);

  useEffect(() => {
    if (!session || !target) return;

    if (target.groupId !== activeGroupId) {
      // Once per target. If the route bounces the switch back, asking again
      // would only fight it.
      if (switchedForRef.current !== target) {
        switchedForRef.current = target;
        latest.current.openGroup(target.groupId, "replace");
      }
      return;
    }
    if (!detailLoaded) return;

    setTarget(null);

    const loaded = expenses.find((expense) => expense.id === target.expenseId);
    if (loaded) {
      latest.current.openExpenseEdit(loaded);
      return;
    }

    // Older than the loaded window. Its own day is a small, exact query.
    latest.current.api
      .searchExpenses(target.groupId, { from: target.expenseDate, to: target.expenseDate, limit: 100 })
      .then((result) => {
        const found = result.expenses.map(toExpense).find((expense) => expense.id === target.expenseId);
        if (found) latest.current.openExpenseEdit(found);
        else latest.current.showToast(text.lineEntryFailed);
      })
      .catch(() => latest.current.showToast(text.lineEntryFailed));
  }, [session, target, activeGroupId, detailLoaded, expenses]);
}
