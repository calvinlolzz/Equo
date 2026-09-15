import { BellRing, ChevronRight, HandCoins, History, Plus, Scan, Share } from "lucide-react";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { InstallHint } from "./InstallHint";
import { MemberAvatar } from "./MemberAvatar";
import { heroBalanceMembers } from "./heroBalanceRows";
import { formatAmount, formatSigned } from "./formatAmount";
import { formatActivityTime, formatRecordStamp } from "./appDates";
import { monthDayLabel } from "./i18n/format";
import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";
import type { Activity, DialogMode, Expense, Group, Member } from "./appTypes";
import type { useInstallPrompt } from "./useInstallPrompt";

const text = UI_TEXT.app;

export type GroupHomeProps = {
  isMobileLayout: boolean;
  /** The active group. Callers must only render <GroupHome> once this is resolved. */
  group: Group;
  install: ReturnType<typeof useInstallPrompt>;
  /** = cloudActiveLoading && !cloudActiveDetail, from App.tsx's cloud state. */
  showSkeleton: boolean;

  members: Member[];
  currentMember: Member | undefined;
  balances: Map<string, number>;
  totalExpenseMinor: number;
  expenses: Expense[];
  activities: Activity[];

  debt: { from: Member; to: Member; amountMinor: number } | null;
  extraTransferCount: number;
  debtNudgeable: boolean;
  debtNudged: boolean;
  pendingAction: string | null;

  spendTab: "personal" | "group";
  onSelectSpendTab: (tab: "personal" | "group") => void;
  spendDisplayAmountMinor: number;
  dateChips: { key: string; day: number; month: number }[];
  selectedDateKey: string;
  selectedDateChip: { key: string; day: number; month: number } | undefined;
  onSelectDateKey: (key: string) => void;
  dateStripRef: (node: HTMLElement | null) => void;

  onOpenDialog: (mode: DialogMode) => void;
  onInviteMembers: () => void;
  onScanReceipt: () => void;
  onSettleDebt: () => void;
  onNudgeMember: (member: Member) => void;
  onOpenExpenseDetail: (expenseId: string) => void;
};

/**
 * The mobile group home: balance summary, member quick actions, spending
 * card, debt card, recent records, recent activity.
 *
 * Pulled out of App.tsx as a pure move (see git history for the commit that
 * did only that, with no behaviour or style change) — App.tsx was pushing
 * 2700 lines and this section alone was its single largest inline block.
 */
export function GroupHome({
  isMobileLayout,
  group,
  install,
  showSkeleton,
  members,
  currentMember,
  balances,
  totalExpenseMinor,
  expenses,
  activities,
  debt,
  extraTransferCount,
  debtNudgeable,
  debtNudged,
  pendingAction,
  spendTab,
  onSelectSpendTab,
  spendDisplayAmountMinor,
  dateChips,
  selectedDateKey,
  selectedDateChip,
  onSelectDateKey,
  dateStripRef,
  onOpenDialog,
  onInviteMembers,
  onScanReceipt,
  onSettleDebt,
  onNudgeMember,
  onOpenExpenseDetail,
}: GroupHomeProps) {
  return (
    <section className="group-room pizo-home enter-content" aria-label={text.groupHome}>
      {/* Root the mobile heading outline: the desktop <h1> lives in the
          group rail, which is inert on mobile, so the workspace would
          otherwise start at <h2>. */}
      {isMobileLayout ? <h1 className="visually-hidden">{group.name}</h1> : null}
      {isMobileLayout ? (
        <InstallHint state={install.state} onInstall={install.promptInstall} onDismiss={install.dismiss} />
      ) : null}
      {showSkeleton ? <GroupHomeSkeleton /> : null}
      <article className="group-home-card glass-panel" id="group-home">
        <div className="home-title-row">
          <div>
            {/* The phone's top bar already carries the group's name, one
                row above this — so this said it twice, 60px apart. The
                wide layout puts the brand up there instead, and this is
                where the name belongs. (The mobile heading outline is
                rooted by the visually-hidden <h1> above.) */}
            {isMobileLayout ? null : <h2>{group.name}</h2>}
            <p>
              {text.members} <strong>{members.length}</strong> {text.total} <strong>{formatAmount(totalExpenseMinor, group.currency)}</strong>
            </p>
          </div>
        </div>

        <div className="hero-member-summary" id="group-members" aria-label={text.members}>
          <div className="hero-avatar-stack" aria-label={text.members}>
            {members.map((member) => (
              <MemberAvatar
                className="hero-avatar"
                key={member.id}
                name={member.name}
                avatarUrl={member.avatarUrl}
              />
            ))}
          </div>
          <div className="hero-balance-list" aria-label={text.analysis}>
            {heroBalanceMembers(members, balances, currentMember?.id).map((member) => (
              <div className="hero-balance-row" key={member.id}>
                <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
                <span>
                  {member.name}
                  {member.role === "owner" ? <small>{text.owner}</small> : null}
                </span>
                <strong>{formatSigned(balances.get(member.id) ?? 0, group.currency)}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Three equal slots. 新增成員 used to take the full width on
            the grounds that it was "the one action most people are here
            for" — but people open a splitting app to record something or
            to see who owes what, and both of those are elsewhere. Adding
            a member is a couple of taps per group, for the life of the
            group. The other two stop being bare icons at the same time:
            a glyph nobody has a name for is not a cheaper button, it is
            a guess. */}
        <div className="member-quick-actions">
          <button className="member-quick-action" type="button" onClick={() => onOpenDialog("memberActions")}>
            <Plus aria-hidden="true" size={19} />
            <span>{text.addMember}</span>
          </button>
          <button className="member-quick-action" type="button" onClick={onInviteMembers}>
            <Share aria-hidden="true" size={19} />
            <span>{text.inviteMembers}</span>
          </button>
          <button className="member-quick-action" type="button" onClick={onScanReceipt}>
            <Scan aria-hidden="true" size={19} />
            <span>{text.scanReceipt}</span>
          </button>
        </div>
      </article>

      <section className="spending-card glass-panel" id="group-analysis" aria-label={text.personalSpend}>
        <div className="section-title-row">
          <div className="tab-pair" aria-label={text.personalSpend}>
            <button className={spendTab === "personal" ? "soft-tab active" : "soft-tab"} type="button" onClick={() => onSelectSpendTab("personal")}>
              {text.personalSpend}
            </button>
            <button className={spendTab === "group" ? "soft-tab active" : "soft-tab"} type="button" onClick={() => onSelectSpendTab("group")}>
              {text.groupSpend}
            </button>
          </div>
          <button className="text-action" type="button" onClick={() => onOpenDialog("analysisPanel")}>
            {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
          </button>
        </div>
        <div className="spending-date-row">
          <div>
            <span>{selectedDateChip
                ? monthDayLabel(selectedDateChip.month, selectedDateChip.day, ACTIVE_LOCALE)
                : monthDayLabel(new Date().getMonth() + 1, new Date().getDate(), ACTIVE_LOCALE)}</span>
            <strong>{formatAmount(spendDisplayAmountMinor, group.currency)}</strong>
          </div>
          <div className="date-chip-row" aria-label={UI_TEXT.misc.dateLabel} ref={dateStripRef}>
            {dateChips.map((chip) => (
              <button
                className={chip.key === selectedDateKey ? "date-chip active" : "date-chip"}
                type="button"
                key={chip.key}
                data-active={chip.key === selectedDateKey}
                onClick={() => onSelectDateKey(chip.key)}
              >
                {chip.day}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section pizo-debt-section" aria-label={text.debt}>
        <div className="section-title-row">
          <h3>{text.debt}</h3>
          <button className="text-action" type="button" onClick={() => onOpenDialog("analysisPanel")}>
            {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
          </button>
        </div>
        <div className="pizo-debt-card">
          {debt ? (
            <>
              <div className="pizo-debt-person">
                <MemberAvatar className="member-avatar lime" name={debt.from.name} avatarUrl={debt.from.avatarUrl} />
                <strong>{debt.from.name}</strong>
              </div>
              <div className="pizo-debt-center">
                <span>{text.needPay}</span>
                <b>{"→"}</b>
                <strong>{formatAmount(debt.amountMinor, group.currency)}</strong>
              </div>
              <div className="pizo-debt-person right">
                <MemberAvatar className="member-avatar photo" name={debt.to.name} avatarUrl={debt.to.avatarUrl} />
                <strong>{debt.to.name}</strong>
              </div>
            </>
          ) : (
            <div className="pizo-debt-empty">{text.settled}</div>
          )}
          {debt ? (
            <div className="pizo-debt-actions">
              <button
                className="settlement-clear-action"
                type="button"
                disabled={pendingAction === `settle:${debt.from.id}:${debt.to.id}`}
                onClick={onSettleDebt}
              >
                {pendingAction === `settle:${debt.from.id}:${debt.to.id}` ? text.processing : text.clearDebt}
              </button>
              {/* 清償 is "I have been paid"; 提醒 is "you haven't paid me
                  yet". Two answers to the same moment, so they belong
                  side by side - 清償 keeps the filled treatment because
                  it is the one that changes the ledger. */}
              {debtNudgeable ? (
                <button
                  className={debtNudged ? "pizo-debt-nudge-action sent" : "pizo-debt-nudge-action"}
                  type="button"
                  aria-label={`${text.nudgeAria}: ${debt.from.name}`}
                  disabled={debtNudged || pendingAction === `nudge:${debt.from.id}`}
                  onClick={() => onNudgeMember(debt.from)}
                >
                  <BellRing aria-hidden="true" size={16} />
                  {debtNudged ? text.nudgeSent : text.nudge}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {extraTransferCount > 0 ? (
          <button className="text-action settlement-more-line" type="button" onClick={() => onOpenDialog("analysisPanel")}>
            {`${UI_TEXT.settlement.moreTransfersPrefix} ${extraTransferCount} ${UI_TEXT.settlement.moreTransfersSuffix}`}
          </button>
        ) : null}
      </section>

      <section className="home-section pizo-record-section" id="group-records" aria-label={text.records}>
        <div className="section-title-row">
          <h3>{text.records}</h3>
          <button className="text-action" type="button" onClick={() => onOpenDialog("recordsPanel")}>
            {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
          </button>
        </div>
        {expenses.length ? (
          <div className="expense-record-list">
            {expenses.slice(0, 5).map((expense) => {
              const payer = members.find((member) => member.id === expense.payerId);
              const shareMembers = expense.shareMemberIds
                .map((id) => members.find((member) => member.id === id))
                .filter((member): member is Member => Boolean(member))
                .slice(0, 3);
              const isSettlement = expense.kind === "settlement";
              const isIncome = expense.kind === "income";
              const extraPayerCount = (expense.payments?.length ?? 0) - 1;
              return (
                <button
                  className="expense-record-row pizo-expense-row"
                  type="button"
                  key={expense.id}
                  onClick={() => onOpenExpenseDetail(expense.id)}
                >
                  {isSettlement ? (
                    <span className="member-avatar photo settlement-avatar">
                      <History aria-hidden="true" size={16} />
                    </span>
                  ) : isIncome ? (
                    <span className="member-avatar photo income-avatar">
                      <HandCoins aria-hidden="true" size={16} />
                    </span>
                  ) : extraPayerCount > 0 ? (
                    <span className="payer-avatar-stack">
                      <MemberAvatar className="member-avatar photo" name={payer?.name} avatarUrl={payer?.avatarUrl} />
                      <i className="payer-count-badge" aria-hidden="true">{`+${extraPayerCount}`}</i>
                    </span>
                  ) : (
                    <MemberAvatar className="member-avatar photo" name={payer?.name} avatarUrl={payer?.avatarUrl} />
                  )}
                  <span className="expense-record-main">
                    <strong>{expense.title}</strong>
                    <small>{formatRecordStamp(expense.createdAt)}</small>
                  </span>
                  <span className={isIncome ? "expense-record-amount amount-income" : "expense-record-amount"}>
                    {/* Only when it is NOT the group's own currency. It
                        used to print on every row, which in a TWD group
                        is "TWD" five times over and no information at
                        all. It still earns its place on a foreign row:
                        formatAmount gives TWD and USD the same $. */}
                    {expense.currency === group.currency ? null : <small>{expense.currency}</small>}
                    {isIncome ? `+${formatAmount(expense.amountMinor, expense.currency)}` : formatAmount(expense.amountMinor, expense.currency)}
                    <i className="mini-avatar-stack" aria-hidden="true">
                      {shareMembers.map((member) => (
                        <em key={member.id}>
                          <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
                        </em>
                      ))}
                    </i>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty-copy">{text.noRecords}</p>
        )}
      </section>

      {/* Gone entirely when there is nothing in it, rather than a
          heading and a 查看全部 wrapped around the words "暫無近期活動".
          An empty section still costs a screenful of scroll on the way
          past, and it is the last thing on the page. */}
      {activities.length ? (
        <section className="home-section pizo-activity-section" aria-label={text.recentActivity}>
          <div className="section-title-row">
            <h3>{text.recentActivity}</h3>
            <button className="text-action" type="button" onClick={() => onOpenDialog("recordsPanel")}>
              {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
            </button>
          </div>
          <div className="pizo-activity-list">
            {activities.slice(0, 5).map((activity) => (
              <div className="activity-row pizo-activity-row" key={activity.id}>
                <strong>{activity.text}</strong>
                <span>{formatActivityTime(activity.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
