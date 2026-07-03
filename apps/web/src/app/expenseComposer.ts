import { UI_TEXT } from "./uiText";

export const COMPOSER_MODES = [
  { id: "expense", label: UI_TEXT.composerModes.expense },
  { id: "income", label: UI_TEXT.composerModes.income },
  { id: "transfer", label: UI_TEXT.composerModes.transfer },
] as const;

export type ComposerMode = (typeof COMPOSER_MODES)[number]["id"];

export function getComposerSubmitState({
  mode,
  canSubmitExpense,
}: {
  mode: ComposerMode;
  canSubmitExpense: boolean;
}) {
  if (mode !== "expense") {
    return {
      disabled: true,
      label: mode === "income" ? UI_TEXT.composerSubmit.incomeUnavailable : UI_TEXT.composerSubmit.transferUnavailable,
      hint: UI_TEXT.composerSubmit.futureModeHint,
    };
  }

  return {
    disabled: !canSubmitExpense,
    label: UI_TEXT.composerSubmit.addExpense,
    hint: UI_TEXT.composerSubmit.expenseHint,
  };
}
