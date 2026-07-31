import { useState } from "react";
import { createApiClient, isNetworkError, type ExpenseSummary } from "./apiClient";
import { dateKey } from "./appDates";
import type { CloudGroupsStore } from "./cloudStore";
import { describeCloudActionError } from "./describeCloudActionError";
import type { DialogMode, Expense, Group, Member } from "./appTypes";
import { buildExpenseCsv, csvFileName } from "./expenseCsv";
import { type ExpenseDraft } from "./ExpenseComposerSheet";
import { expenseToDraft } from "./expenseUndo";
import { haptic } from "./haptics";
import { formatAmount } from "./formatAmount";
import type { StoredSession } from "./sessionStore";
import type { ToastAction } from "./useToast";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type UseExpenseComposerDeps = {
  activeGroup: Group | null;
  cloudStore: CloudGroupsStore | null;
  members: Member[];
  session: StoredSession | null;
  showToast: (message: string, action?: ToastAction) => void;
  recordCloudActivity: (groupId: string, activityText: string) => void;
  beginAction: (key: string) => boolean;
  endAction: () => void;
  setDialog: (dialog: DialogMode) => void;
  setBusy: (busy: boolean) => void;
};

/**
 * The add/edit expense composer and everything that mutates expenses.
 *
 * The composer is one sheet reused for both create and edit: editingExpense
 * decides which (null = create). selectedExpenseId is the separate cursor for
 * the read-only detail dialog, kept here too so its prev/next navigation and
 * the delete/edit actions launched from it stay in one place.
 *
 * Deleting is undoable: deleteExpense captures the expense snapshot and offers a
 * toast action that re-creates it (with a new id - a server delete is not
 * reversible), so the target group/currency are pinned up front in case the
 * user has navigated away by the time they tap 復原.
 */
export function useExpenseComposer({
  activeGroup,
  cloudStore,
  members,
  session,
  showToast,
  recordCloudActivity,
  beginAction,
  endAction,
  setDialog,
  setBusy,
}: UseExpenseComposerDeps) {
  const [expenseComposerOpen, setExpenseComposerOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  /**
   * The expense a 重複這筆 was launched from. Separate from editingExpense on
   * purpose: it seeds the same sheet, but the submit path below keys create vs.
   * replace off editingExpense alone, so a duplicate can never overwrite the
   * entry it was copied from.
   */
  const [duplicatingExpense, setDuplicatingExpense] = useState<Expense | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>("");

  /** Open the composer for a brand-new expense (never carrying a prior edit). */
  function openExpenseComposer() {
    setEditingExpense(null);
    setDuplicatingExpense(null);
    setExpenseComposerOpen(true);
  }

  function openExpenseEdit(expense: Expense) {
    setDialog(null);
    setSelectedExpenseId("");
    setDuplicatingExpense(null);
    setEditingExpense(expense);
    setExpenseComposerOpen(true);
  }

  function openExpenseDuplicate(expense: Expense) {
    setDialog(null);
    setSelectedExpenseId("");
    setEditingExpense(null);
    setDuplicatingExpense(expense);
    setExpenseComposerOpen(true);
  }

  function closeExpenseComposer() {
    setExpenseComposerOpen(false);
    setEditingExpense(null);
    setDuplicatingExpense(null);
  }

  function openExpenseDetail(expenseId: string) {
    setSelectedExpenseId(expenseId);
    setDialog("expenseDetail");
  }

  async function handleExpenseDraftSubmit(draft: ExpenseDraft) {
    if (!activeGroup || !cloudStore) return;
    const editingId = editingExpense?.id;

    let finalDraft = draft;
    if (draft.imageDataUrl) {
      setBusy(true);
      try {
        const uploadedUrl = await cloudStore.uploadGroupImage(activeGroup.id, "expense", draft.imageDataUrl);
        finalDraft = { ...draft, imageUrl: uploadedUrl, imageDataUrl: undefined };
      } catch (error) {
        setBusy(false);
        // Unreachable network, not a rejected upload: keep the data URL on the
        // draft and let cloudStore queue it - the photo is uploaded on flush,
        // just before the expense itself. Any other failure still aborts.
        if (!isNetworkError(error)) {
          showToast(text.imageUploadFailed);
          return;
        }
      }
      setBusy(false);
    }

    try {
      if (editingId) {
        await cloudStore.editExpense(activeGroup.id, editingId, finalDraft, activeGroup.currency);
      } else {
        await cloudStore.addExpense(activeGroup.id, finalDraft, activeGroup.currency);
      }
      recordCloudActivity(
        activeGroup.id,
        editingId
          ? `${text.editExpense}: ${draft.title}`
          : `${text.addExpense}: ${draft.title} (${formatAmount(draft.amountMinor, activeGroup.currency)})`,
      );
      setExpenseComposerOpen(false);
      setEditingExpense(null);
      setDuplicatingExpense(null);
      haptic("success");
      showToast(editingId ? `${text.editExpense}: ${draft.title}` : `${text.addExpense}: ${draft.title}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    }
  }

  async function deleteExpense(expense: Expense) {
    if (!activeGroup || !cloudStore) return;
    // Capture the target group up front so undo re-creates the expense in the
    // right group even if the user navigates away before tapping 復原.
    const groupId = activeGroup.id;
    const groupCurrency = activeGroup.currency;

    try {
      await cloudStore.deleteExpense(groupId, expense.id);
      recordCloudActivity(groupId, `${text.deleteExpense}: ${expense.title}`);
      setDialog(null);
      setSelectedExpenseId("");
      haptic("warning");
      showToast(`${text.deleteExpense}: ${expense.title}`, {
        label: text.undo,
        onAction: () => restoreExpense(groupId, groupCurrency, expense),
      });
    } catch (error) {
      showToast(describeCloudActionError(error));
    }
  }

  // Re-create a just-deleted expense from its captured snapshot. The recreated
  // expense gets a new id (a delete is not reversible server-side) - that is
  // acceptable; the split, payers, note, image and timestamp are preserved.
  async function restoreExpense(groupId: string, groupCurrency: string, expense: Expense) {
    if (!cloudStore) return;
    if (!beginAction("undoDeleteExpense")) return;

    try {
      await cloudStore.addExpense(groupId, expenseToDraft(expense), groupCurrency);
      recordCloudActivity(groupId, `${text.undoRestored}: ${expense.title}`);
      showToast(text.undoRestored);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      endAction();
    }
  }

  async function handleLoadMoreExpenses() {
    if (!activeGroup || !cloudStore) return;
    if (!beginAction("loadMoreExpenses")) return;
    try {
      await cloudStore.loadMoreExpenses(activeGroup.id);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      endAction();
    }
  }

  async function handleExportCsv() {
    if (!activeGroup || !session) return;
    if (!beginAction("exportCsv")) return;
    try {
      // The loaded window may be paginated - walk listExpensesPage until a
      // short page so the export always covers the group's full history.
      const client = createApiClient();
      const pageLimit = 100;
      const all: ExpenseSummary[] = [];
      let cursor: { beforeDate?: string; beforeCreatedAt?: string } = {};

      for (;;) {
        const page = await client.listExpensesPage(activeGroup.id, { limit: pageLimit, ...cursor });
        all.push(...page.expenses);
        if (page.expenses.length < pageLimit) break;
        const last = page.expenses[page.expenses.length - 1];
        if (!last.expense_date || !last.created_at) break;
        cursor = { beforeDate: last.expense_date, beforeCreatedAt: last.created_at };
      }

      const memberName = (memberId: string | null | undefined) =>
        members.find((member) => member.id === memberId)?.name ?? "";
      const csv = buildExpenseCsv(all, memberName);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvFileName(activeGroup.name, dateKey(new Date().toISOString()));
      anchor.click();
      URL.revokeObjectURL(url);
      showToast(text.exportCsvDone);
    } catch {
      showToast(text.exportCsvFailed);
    } finally {
      endAction();
    }
  }

  return {
    expenseComposerOpen,
    editingExpense,
    duplicatingExpense,
    selectedExpenseId,
    setSelectedExpenseId,
    openExpenseComposer,
    openExpenseEdit,
    openExpenseDuplicate,
    closeExpenseComposer,
    openExpenseDetail,
    handleExpenseDraftSubmit,
    deleteExpense,
    handleLoadMoreExpenses,
    handleExportCsv,
  };
}
