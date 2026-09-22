import { UI_TEXT } from "./uiText";

export const COMPOSER_MODES = [
  { id: "expense", label: UI_TEXT.composerModes.expense },
  { id: "income", label: UI_TEXT.composerModes.income },
  { id: "transfer", label: UI_TEXT.composerModes.transfer },
] as const;

export type ComposerMode = (typeof COMPOSER_MODES)[number]["id"];

/**
 * The modes a personal ledger offers: 支出/收入 only. No 轉帳 - a transfer to
 * yourself moves no money, and there is nobody else in the ledger to send it
 * to (see the plan's §9, deferred-out list).
 */
export const PERSONAL_COMPOSER_MODES = COMPOSER_MODES.filter((mode) => mode.id !== "transfer");

const SUBMIT_LABELS: Record<ComposerMode, string> = {
  expense: UI_TEXT.composerSubmit.addExpense,
  income: UI_TEXT.composerSubmit.addIncome,
  transfer: UI_TEXT.composerSubmit.addTransfer,
};

const SUBMIT_HINTS: Record<ComposerMode, string> = {
  expense: UI_TEXT.composerSubmit.expenseHint,
  income: UI_TEXT.composerSubmit.incomeHint,
  transfer: UI_TEXT.composerSubmit.transferHint,
};

/**
 * Submit button state for the composer. All three modes are live: the
 * button is enabled whenever the current mode's draft passes its gating
 * (see canSubmitExpenseDraft / canSubmitTransferDraft), and the label is
 * 新增支出 / 新增收入 / 新增轉帳 on create - editing keeps 儲存變更 for
 * every kind.
 */
export function getComposerSubmitState({
  mode,
  canSubmit,
  isEditing = false,
}: {
  mode: ComposerMode;
  canSubmit: boolean;
  isEditing?: boolean;
}) {
  return {
    disabled: !canSubmit,
    label: isEditing ? UI_TEXT.app.saveChanges : SUBMIT_LABELS[mode],
    hint: SUBMIT_HINTS[mode],
  };
}
