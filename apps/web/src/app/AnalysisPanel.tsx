import type { SettlementTransfer } from "../domain/settlement";
import type { SpendBreakdown, SpendPeriodKind } from "./apiClient";
import { formatActivityTime } from "./appDates";
import type { Member } from "./appTypes";
import { formatAmount } from "./formatAmount";
import { describeMemberBalance } from "./groupBalanceSummary";
import { MemberAvatar } from "./MemberAvatar";
import type { SettlementHistory } from "./useSettlementHistory";
import { SpendBarChart } from "./SpendBarChart";
import type { SpendByDayEntry, SpendChartDay } from "./spendChart";
import { SpendPeriodSection } from "./SpendPeriodSection";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type AnalysisPanelProps = {
  totalExpenseMinor: number;
  currency: string;
  /** 每月預算 for this group, or null when nobody set one. */
  monthlyBudgetMinor?: number | null;
  members: Member[];
  balances: Map<string, number>;
  maxBalanceMinor: number;
  settlementTransfers: SettlementTransfer[];
  /** 清償紀錄 over the group's whole history — see useSettlementHistory. */
  settlementHistory: SettlementHistory;
  dateChips: SpendChartDay[];
  spendByDay: SpendByDayEntry[];
  selectedDateKey: string;
  pendingAction: string | null;
  /** The logged-in user's own member row, so 收款資訊 shows only on rows they have to pay. */
  currentMemberId?: string;
  onSelectDate: (key: string) => void;
  onCopyPaymentNote?: (note: string) => void;
  onSettleTransfer: (fromMemberId: string, toMemberId: string, amountMinor: number) => void;
  /** Shared with the home screen's 消費 card so the two surfaces never disagree. */
  spendTab: "personal" | "group";
  onSelectSpendTab: (tab: "personal" | "group") => void;
  spendBreakdown: {
    breakdown: SpendBreakdown | null;
    periodKind: SpendPeriodKind;
    periodKey: string | null;
    loading: boolean;
    error: string | null;
    selectPeriodKind: (kind: SpendPeriodKind) => void;
    selectPeriodKey: (key: string) => void;
    retry: () => void;
  };
  /**
   * True for the caller's own personal ledger. Hides everything that only
   * means something with more than one member: the 個人／群組 tabs (a
   * ledger's spend IS the personal figure, so SpendPeriodSection is forced
   * to "group" scope instead), the members/debt stat tiles, the per-member
   * balance bars, and both settlement sections - there is nobody else to
   * settle with.
   */
  personal?: boolean;
};

/** The 分析 bottom-sheet content (stats, spend chart, balances, settlement suggestions + history). */
export function AnalysisPanel({
  totalExpenseMinor,
  currency,
  monthlyBudgetMinor,
  members,
  balances,
  maxBalanceMinor,
  settlementTransfers,
  settlementHistory,
  dateChips,
  spendByDay,
  selectedDateKey,
  pendingAction,
  currentMemberId,
  onSelectDate,
  onCopyPaymentNote,
  onSettleTransfer,
  spendTab,
  onSelectSpendTab,
  spendBreakdown,
  personal = false,
}: AnalysisPanelProps) {
  // The 近 8 日支出 chart looks empty with only a day or two of data, so only
  // show it once there's enough spread to be worth a chart.
  const spendTotalsByDay = new Map(spendByDay.map((entry) => [entry.day, entry.totalMinor]));
  const daysWithSpend = dateChips.filter((day) => (spendTotalsByDay.get(day.key) ?? 0) > 0).length;
  // The minimal-transfer routing can leave several transfers outstanding at
  // once (buildSettlementTransfers), so the tile is their sum - not the
  // first one, which is neither a total nor even the largest.
  const outstandingMinor = settlementTransfers.reduce((sum, transfer) => sum + transfer.amount.amount_minor, 0);

  return (
    <>
      <div className="dialog-header">
        <h3>{text.analysis}</h3>
        <p>{UI_TEXT.analysis.description}</p>
      </div>
      {/* The indicator is one element that slides between the two halves, so
          the underline travels rather than blinking from tab to tab. Its
          position is driven by data-active, not an inline transform.
          A personal ledger has no 個人／群組 distinction - it's all the
          same person - so the tabs don't exist there at all. */}
      {personal ? null : (
        <div className="slide-tabs" data-active={spendTab} role="tablist" aria-label={text.analysis}>
          <button
            className={spendTab === "personal" ? "slide-tab active" : "slide-tab"}
            type="button"
            role="tab"
            aria-selected={spendTab === "personal"}
            onClick={() => onSelectSpendTab("personal")}
          >
            {text.personalSpend}
          </button>
          <button
            className={spendTab === "group" ? "slide-tab active" : "slide-tab"}
            type="button"
            role="tab"
            aria-selected={spendTab === "group"}
            onClick={() => onSelectSpendTab("group")}
          >
            {text.groupSpend}
          </button>
          <i className="slide-tabs-indicator" aria-hidden="true" />
        </div>
      )}
      <SpendPeriodSection
        breakdown={spendBreakdown.breakdown}
        periodKind={spendBreakdown.periodKind}
        periodKey={spendBreakdown.periodKey}
        scope={personal ? "group" : spendTab}
        loading={spendBreakdown.loading}
        error={spendBreakdown.error}
        currency={currency}
        monthlyBudgetMinor={monthlyBudgetMinor}
        onSelectKind={spendBreakdown.selectPeriodKind}
        onSelectKey={spendBreakdown.selectPeriodKey}
        onRetry={spendBreakdown.retry}
      />
      <div className="panel-stat-grid">
        <div>
          <span>{UI_TEXT.records.totalSpend}</span>
          <strong>{formatAmount(totalExpenseMinor, currency)}</strong>
        </div>
        {personal ? null : (
          <>
            <div>
              <span>{text.members}</span>
              <strong>{members.length}</strong>
            </div>
            <div>
              <span>{text.outstandingTotal}</span>
              <strong>{formatAmount(outstandingMinor, currency)}</strong>
            </div>
          </>
        )}
      </div>
      {daysWithSpend >= 2 && (
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
      )}
      {personal ? null : (
      <div className="dialog-section-list">
        <span className="dialog-list-title">{UI_TEXT.analysis.memberBalances}</span>
        {members.map((member) => {
          const balance = balances.get(member.id) ?? 0;
          const width = balance === 0 ? "0%" : `${Math.max(8, Math.round((Math.abs(balance) / maxBalanceMinor) * 100))}%`;
          return (
            <div className="analysis-balance-row" key={member.id}>
              <span>{member.name}</span>
              <div className="analysis-bar-track">
                <i style={{ width }} />
              </div>
              <strong>{describeMemberBalance(balance, currency, member.id === currentMemberId)}</strong>
            </div>
          );
        })}
      </div>
      )}
      {personal ? null : (
      <div className="dialog-section-list">
        <span className="dialog-list-title">{UI_TEXT.settlement.suggestionSectionTitle}</span>
        {settlementTransfers.length ? (
          settlementTransfers.map((transfer) => {
            const from = members.find((member) => member.id === transfer.fromMemberId);
            const to = members.find((member) => member.id === transfer.toMemberId);
            // 收款資訊 belongs on the row where the reader is the one paying:
            // that is the moment they need an account number, and showing
            // everybody's on every row would be noise, not help.
            const owedByMe = Boolean(currentMemberId) && transfer.fromMemberId === currentMemberId;
            const payeeNote = to?.paymentNote?.trim() ?? "";
            return (
              <div className="settlement-suggestion-group" key={`${transfer.fromMemberId}_${transfer.toMemberId}`}>
                <div className="settlement-suggestion-row">
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
                {owedByMe &&
                  (payeeNote ? (
                    <div className="settlement-payment-note">
                      <span className="settlement-payment-note__label">{UI_TEXT.paymentNote.payTo}</span>
                      <span className="settlement-payment-note__value">{payeeNote}</span>
                      {onCopyPaymentNote && (
                        <button
                          className="composer-mini-action"
                          type="button"
                          onClick={() => onCopyPaymentNote(payeeNote)}
                        >
                          {UI_TEXT.paymentNote.copy}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="settlement-payment-note settlement-payment-note--empty">
                      {UI_TEXT.paymentNote.missing}
                    </p>
                  ))}
              </div>
            );
          })
        ) : (
          <p className="dialog-empty">{UI_TEXT.settlement.settled}</p>
        )}
      </div>
      )}
      {personal ? null : (
      <div className="dialog-section-list">
        <span className="dialog-list-title">{text.settlementHistoryTitle}</span>
        {settlementHistory.records.length ? (
          settlementHistory.records.map((record) => {
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
        ) : settlementHistory.loading ? (
          <p className="dialog-empty">{UI_TEXT.settlement.historyLoading}</p>
        ) : (
          <p className="dialog-empty">{text.noSettlementHistory}</p>
        )}
        {/* The list is capped; say so rather than letting it look complete. */}
        {settlementHistory.matchCount > settlementHistory.records.length && (
          <p className="dialog-empty">
            {`${UI_TEXT.settlement.historyTruncatedPrefix}${settlementHistory.matchCount}${UI_TEXT.settlement.historyTruncatedSuffix}${settlementHistory.records.length}${UI_TEXT.settlement.historyTruncatedTail}`}
          </p>
        )}
        {settlementHistory.degraded && (
          <p className="dialog-empty">{UI_TEXT.settlement.historyDegraded}</p>
        )}
      </div>
      )}
    </>
  );
}
