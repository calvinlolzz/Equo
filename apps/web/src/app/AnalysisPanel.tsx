import type { SettlementTransfer } from "../domain/settlement";
import { formatActivityTime } from "./appDates";
import type { Member } from "./appTypes";
import { formatAmount, formatSigned } from "./formatAmount";
import { MemberAvatar } from "./MemberAvatar";
import type { SettlementRecord } from "./settlementHistory";
import { SpendBarChart } from "./SpendBarChart";
import type { SpendByDayEntry, SpendChartDay } from "./spendChart";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type AnalysisPanelProps = {
  totalExpenseMinor: number;
  currency: string;
  members: Member[];
  balances: Map<string, number>;
  maxBalanceMinor: number;
  debtAmountMinor: number;
  settlementTransfers: SettlementTransfer[];
  settlementRecords: SettlementRecord[];
  dateChips: SpendChartDay[];
  spendByDay: SpendByDayEntry[];
  selectedDateKey: string;
  pendingAction: string | null;
  onSelectDate: (key: string) => void;
  onSettleTransfer: (fromMemberId: string, toMemberId: string, amountMinor: number) => void;
};

/** The 分析 bottom-sheet content (stats, spend chart, balances, settlement suggestions + history). */
export function AnalysisPanel({
  totalExpenseMinor,
  currency,
  members,
  balances,
  maxBalanceMinor,
  debtAmountMinor,
  settlementTransfers,
  settlementRecords,
  dateChips,
  spendByDay,
  selectedDateKey,
  pendingAction,
  onSelectDate,
  onSettleTransfer,
}: AnalysisPanelProps) {
  return (
    <>
      <div className="dialog-header">
        <h3>{text.analysis}</h3>
        <p>{"以目前資料統計群組消費與成員餘額。"}</p>
      </div>
      <div className="panel-stat-grid">
        <div>
          <span>{"總金額"}</span>
          <strong>{formatAmount(totalExpenseMinor, currency)}</strong>
        </div>
        <div>
          <span>{text.members}</span>
          <strong>{members.length}</strong>
        </div>
        <div>
          <span>{text.debt}</span>
          <strong>{formatAmount(debtAmountMinor, currency)}</strong>
        </div>
      </div>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{text.spendChartTitle}</span>
        <SpendBarChart
          days={dateChips}
          spendByDay={spendByDay}
          currency={currency}
          selectedKey={selectedDateKey}
          onSelect={onSelectDate}
          emptyText={text.spendChartEmpty}
        />
      </div>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{"成員餘額"}</span>
        {members.map((member) => {
          const balance = balances.get(member.id) ?? 0;
          const width = balance === 0 ? "0%" : `${Math.max(8, Math.round((Math.abs(balance) / maxBalanceMinor) * 100))}%`;
          return (
            <div className="analysis-balance-row" key={member.id}>
              <span>{member.name}</span>
              <div className="analysis-bar-track">
                <i style={{ width }} />
              </div>
              <strong>{formatSigned(balance, currency)}</strong>
            </div>
          );
        })}
      </div>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{UI_TEXT.settlement.suggestionSectionTitle}</span>
        {settlementTransfers.length ? (
          settlementTransfers.map((transfer) => {
            const from = members.find((member) => member.id === transfer.fromMemberId);
            const to = members.find((member) => member.id === transfer.toMemberId);
            return (
              <div className="settlement-suggestion-row" key={`${transfer.fromMemberId}_${transfer.toMemberId}`}>
                <div className="settlement-suggestion-person">
                  <MemberAvatar className="member-avatar lime" name={from?.name} avatarUrl={from?.avatarUrl} />
                  <strong>{from?.name ?? ""}</strong>
                </div>
                <b>{"→"}</b>
                <div className="settlement-suggestion-person">
                  <MemberAvatar className="member-avatar photo" name={to?.name} avatarUrl={to?.avatarUrl} />
                  <strong>{to?.name ?? ""}</strong>
                </div>
                <span className="settlement-suggestion-amount">{formatAmount(transfer.amount.amount_minor, transfer.amount.currency)}</span>
                <button
                  className="composer-mini-action"
                  type="button"
                  disabled={pendingAction === `settle:${transfer.fromMemberId}:${transfer.toMemberId}`}
                  onClick={() => onSettleTransfer(transfer.fromMemberId, transfer.toMemberId, transfer.amount.amount_minor)}
                >
                  {pendingAction === `settle:${transfer.fromMemberId}:${transfer.toMemberId}`
                    ? text.processing
                    : UI_TEXT.settlement.settleAction}
                </button>
              </div>
            );
          })
        ) : (
          <p className="dialog-empty">{UI_TEXT.settlement.settled}</p>
        )}
      </div>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{text.settlementHistoryTitle}</span>
        {settlementRecords.length ? (
          settlementRecords.map((record) => {
            const from = members.find((member) => member.id === record.fromMemberId);
            const to = members.find((member) => member.id === record.toMemberId);
            return (
              <div className="settlement-suggestion-row" key={record.id}>
                <div className="settlement-suggestion-person">
                  <MemberAvatar className="member-avatar lime" name={from?.name} avatarUrl={from?.avatarUrl} />
                  <strong>{from?.name ?? ""}</strong>
                </div>
                <b>{"→"}</b>
                <div className="settlement-suggestion-person">
                  <MemberAvatar className="member-avatar photo" name={to?.name} avatarUrl={to?.avatarUrl} />
                  <strong>{to?.name ?? ""}</strong>
                </div>
                <span className="settlement-suggestion-amount">{formatAmount(record.amountMinor, record.currency)}</span>
                <small className="settlement-history-time">{formatActivityTime(record.createdAt)}</small>
              </div>
            );
          })
        ) : (
          <p className="dialog-empty">{text.noSettlementHistory}</p>
        )}
      </div>
    </>
  );
}
