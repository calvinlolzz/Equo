import type { SettlementTransferSummary } from "./apiClient";
import { UI_TEXT } from "./uiText";

export function getSettlementPanelSummary(transfers: SettlementTransferSummary[]) {
  const totalAmountMinor = transfers.reduce((sum, transfer) => sum + transfer.amount.amount_minor, 0);
  const transferCount = transfers.length;

  return {
    transferCount,
    totalAmountMinor,
    statusLabel: transferCount === 0 ? UI_TEXT.settlement.settled : `${transferCount} ${UI_TEXT.settlement.transferSuggestionSuffix}`,
    isSettled: transferCount === 0,
  };
}
