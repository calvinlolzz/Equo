import { useEffect, useId, useState, type ReactNode } from "react";
import { BellRing, ChevronRight, HandCoins, History, Plus, Scan } from "lucide-react";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { InstallHint } from "./InstallHint";
import { MemberAvatar } from "./MemberAvatar";
import { heroBalanceMembers } from "./heroBalanceRows";
import { formatAmount, formatSigned } from "./formatAmount";
import { formatActivityTime, formatRecordStamp } from "./appDates";
import { monthDayLabel } from "./i18n/format";
import { settlementBetween, type SettlementIntent } from "./settlementActions";
import { useAnimatedHeight } from "./useAnimatedHeight";
import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";
import type { Activity, DialogMode, Expense, Group, Member } from "./appTypes";
import type { useInstallPrompt } from "./useInstallPrompt";

const text = UI_TEXT.app;

/** Above this many members, the row list stops showing everyone (see §2.4). */
const CROWDED_MEMBER_COUNT = 6;
/** How many rows a crowded group shows before "查看全部". */
const CROWDED_ROW_LIMIT = 5;

export type GroupHomeProps = {
  isMobileLayout: boolean;
  /** The active group. Callers must only render <GroupHome> once this is resolved. */
  group: Group;
  install: ReturnType<typeof useInstallPrompt>;
  /** = cloudActiveLoading && !cloudActiveDetail, from App.tsx's cloud state. */
  showSkeleton: boolean;
  /**
   * = Boolean(cloudActiveDetail): whether this group's actual detail payload
   * has arrived at least once. Gates `emptyGroup` below - members/expenses
   * are both `[]` before the first successful fetch too, which reads exactly
   * like a brand-new group. showSkeleton looks similar but answers a
   * different question (show the loading placeholder?) and has its own
   * narrow window - true only once `cloudActiveLoading` has been *set*,
   * which is a tick later than routing to the group - where it stays false
   * while this is also false. This prop is the direct, un-derived signal.
   */
  hasLoadedDetail: boolean;

  members: Member[];
  currentMember: Member | undefined;
  balances: Map<string, number>;
  totalExpenseMinor: number;
  /** The group's true expense count (aggregates.expenseCount) - expenses may be a capped window. */
  expenseCount: number;
  /** settlementTransfers.length === 0: nothing left to clear anywhere in the group. */
  groupSettled: boolean;
  expenses: Expense[];
  activities: Activity[];
  /** Members reminded this session - see App.tsx's nudgeMember/nudgeEveryDebtor. */
  nudgedMemberIds: string[];
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
  onOpenExpenseComposer: () => void;
  /** = settleTransfer(fromId, toId, amountMinor): opens the settle-confirm dialog seeded with this pair. */
  onSettleTransfer: (fromId: string, toId: string, amountMinor: number) => void;
  onNudgeMember: (member: Member) => void;
  /** "提醒 N 位成員" - every current debtor at once. See App.tsx's nudgeEveryDebtor. */
  onNudgeAll: (targets: Member[]) => void;
  onOpenExpenseDetail: (expenseId: string) => void;
};

type BalanceCardProps = {
  currency: string;
  myBalanceMinor: number;
  /** Everyone but you who currently owes the group, sorted by |balance| desc. */
  debtors: { id: string; amountMinor: number }[];
  groupSettled: boolean;
};

/**
 * The first thing on the home screen: what you personally are owed or owe,
 * and (when it's more than one person) who.
 *
 * Collapses to a single line the moment there is nothing left to say - a
 * settled group, or a settled you in a group that still owes itself money.
 */
function BalanceCard({ currency, myBalanceMinor, debtors, groupSettled }: BalanceCardProps) {
  if (groupSettled) {
    return <p className="home-balance-settled">{text.settled}</p>;
  }

  if (myBalanceMinor > 0) {
    // A one-segment bar has nothing to compare against - it would just be a
    // full-width rectangle, worse than no bar at all.
    const showBar = debtors.length >= 2;
    const barTotal = Math.max(1, debtors.reduce((sum, debtor) => sum + debtor.amountMinor, 0));
    return (
      <div className="home-balance-card">
        <span className="home-balance-lead">{`${debtors.length} ${text.owedByCount}`}</span>
        <strong className="home-balance-amount">{formatAmount(myBalanceMinor, currency)}</strong>
        {showBar ? (
          <div className="home-balance-bar" aria-hidden="true">
            {debtors.map((debtor) => (
              <i key={debtor.id} style={{ width: `${(debtor.amountMinor / barTotal) * 100}%` }} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (myBalanceMinor < 0) {
    return (
      <div className="home-balance-card">
        <span className="home-balance-lead">{text.needPay}</span>
        <strong className="home-balance-amount">{formatAmount(Math.abs(myBalanceMinor), currency)}</strong>
      </div>
    );
  }

  // You're square, but the group as a whole is not (somebody else owes
  // somebody else) - worth saying, but only about you.
  return <p className="home-balance-settled">{text.balanceSettled}</p>;
}

type MemberRowProps = {
  member: Member;
  currency: string;
  balanceMinor: number;
  expanded: boolean;
  onToggle: () => void;
  /** What settling directly with this person would mean - null when there's nothing to settle. */
  settleIntent: SettlementIntent | null;
  nudgeable: boolean;
  nudged: boolean;
  pendingAction: string | null;
  onSettle: (intent: SettlementIntent) => void;
  onNudge: (member: Member) => void;
  onViewDetail: () => void;
};

/**
 * One member, collapsed to a name and a number until tapped.
 *
 * Its own useAnimatedHeight instance, not one shared across the list: only
 * one row is ever open at a time, but each row's actions box independently
 * grows from nothing, and the hook animates exactly one box per call. Rows
 * are components (not inline JSX in a .map()) so each gets to call the hook
 * once, which the rules of hooks would not allow inside the callback itself.
 */
function MemberRow({
  member,
  currency,
  balanceMinor,
  expanded,
  onToggle,
  settleIntent,
  nudgeable,
  nudged,
  pendingAction,
  onSettle,
  onNudge,
  onViewDetail,
}: MemberRowProps) {
  const bodyRef = useAnimatedHeight<HTMLDivElement>();
  const bodyId = useId();

  // There is no "last reminded N days ago" anywhere in this app - the server
  // only ever answers nudge attempts with a status, never a timestamp, and
  // the only memory of a reminder is this session's nudgedMemberIds. So the
  // status line says what is actually known: reminded (this session), or
  // what kind of member this is - not a time that would be invented.
  const statusText = nudged ? text.nudgeSent : member.virtual ? text.virtualMember : member.role === "owner" ? text.owner : text.member;

  return (
    <div className="member-row">
      <button
        className="member-row-head"
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
        <span className="member-row-name">
          <strong>{member.name}</strong>
          {expanded ? <small>{statusText}</small> : null}
        </span>
        <strong className="member-row-amount">{formatSigned(balanceMinor, currency)}</strong>
        <ChevronRight className="member-row-caret" aria-hidden="true" size={16} />
      </button>
      <div className="member-row-body" id={bodyId} ref={bodyRef}>
        {expanded ? (
          <div className="member-row-actions">
            {settleIntent ? (
              <button
                className="settlement-clear-action"
                type="button"
                disabled={pendingAction === `settle:${settleIntent.fromMemberId}:${settleIntent.toMemberId}`}
                onClick={() => onSettle(settleIntent)}
              >
                {pendingAction === `settle:${settleIntent.fromMemberId}:${settleIntent.toMemberId}` ? text.processing : text.clearDebt}
              </button>
            ) : null}
            {nudgeable ? (
              <button
                className={nudged ? "home-row-nudge-action sent" : "home-row-nudge-action"}
                type="button"
                aria-label={`${text.nudgeAria}: ${member.name}`}
                disabled={nudged || pendingAction === `nudge:${member.id}`}
                onClick={() => onNudge(member)}
              >
                <BellRing aria-hidden="true" size={16} />
                {nudged ? text.nudgeSent : text.nudge}
              </button>
            ) : null}
            <button className="text-action" type="button" onClick={onViewDetail}>
              {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type HomeDisclosureProps = {
  /** Only set where something outside this component needs to find the section (records, analysis). */
  id?: string;
  label: string;
  /** Hidden while open - the body already says the same thing, more precisely. */
  summary: ReactNode;
  /** The records row's scan-receipt button: a recording action, not part of the disclosure itself. */
  headExtra?: ReactNode;
  children: ReactNode;
};

/**
 * One of the three "point-and-it-opens" summary rows below the member list:
 * 最近記錄 / 這個月 / 動態. Starts collapsed and stays that way until tapped -
 * see GroupHome's `key={group.id}` on each instance for why switching groups
 * doesn't leave one of these pinned open on stale content.
 */
function HomeDisclosure({ id, label, summary, headExtra, children }: HomeDisclosureProps) {
  const [open, setOpen] = useState(false);
  const bodyRef = useAnimatedHeight<HTMLDivElement>();
  const bodyId = useId();

  return (
    <section className="home-section home-disclosure" id={id} aria-label={label}>
      <div className="section-title-row home-disclosure-head">
        <button
          className="home-disclosure-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="home-disclosure-title">{label}</span>
          <span className="home-disclosure-summary">{open ? null : summary}</span>
          <ChevronRight className="home-disclosure-caret" aria-hidden="true" size={16} />
        </button>
        {headExtra}
      </div>
      <div className="home-disclosure-body" id={bodyId} ref={bodyRef}>
        {open ? children : null}
      </div>
    </section>
  );
}

/**
 * The mobile group home: a balance card, a disclosable member list, and
 * three disclosable summary rows (records / spend / activity).
 *
 * Second-stage redesign of what used to be a fixed hero card + debt card +
 * always-expanded record/activity sections (see git history for the
 * first-stage commit, which only moved this file without changing it). The
 * page now shows a name and a number for everyone, and asks a tap before it
 * shows anything more - see groupHomeDisclosure.test.tsx for what that
 * collapsed state is required to look like.
 */
export function GroupHome({
  isMobileLayout,
  group,
  install,
  showSkeleton,
  hasLoadedDetail,
  members,
  currentMember,
  balances,
  totalExpenseMinor,
  expenseCount,
  groupSettled,
  expenses,
  activities,
  nudgedMemberIds,
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
  onOpenExpenseComposer,
  onSettleTransfer,
  onNudgeMember,
  onNudgeAll,
  onOpenExpenseDetail,
}: GroupHomeProps) {
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  // "收合狀態不記住": every landing starts with every row shut, including a
  // return trip through a different group - this component does not unmount
  // between groups (see App.tsx), so that has to be an explicit reset rather
  // than relying on initial state.
  useEffect(() => {
    setExpandedMemberId(null);
  }, [group.id]);

  // hasLoadedDetail matters, not just belt-and-braces: members/expenses are
  // both [] before the first successful fetch too, which reads exactly like
  // a brand-new group. Without the guard, a normal group with a long history
  // flashes 記一筆/邀請成員 for a frame on every visit before the real
  // content replaces it.
  const emptyGroup = hasLoadedDetail && expenses.length === 0 && members.length <= 1;
  const myBalanceMinor = currentMember ? balances.get(currentMember.id) ?? 0 : 0;
  const debtors = members
    .filter((member) => member.id !== currentMember?.id && (balances.get(member.id) ?? 0) < 0)
    .map((member) => ({ id: member.id, amountMinor: Math.abs(balances.get(member.id) ?? 0) }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  // ≤6 people: everyone gets a row, ranked (you first). More than that, and
  // "everyone" stops being a useful list - drop anybody flat (except you,
  // always) and cap it, with 查看全部 for the rest.
  const crowded = members.length > CROWDED_MEMBER_COUNT;
  const rowCandidates = crowded
    ? members.filter((member) => member.id === currentMember?.id || (balances.get(member.id) ?? 0) !== 0)
    : members;
  const rowMembers = heroBalanceMembers(rowCandidates, balances, currentMember?.id, crowded ? CROWDED_ROW_LIMIT : undefined);

  const nudgeTargets = members.filter(
    (member) =>
      !member.virtual &&
      member.id !== currentMember?.id &&
      (balances.get(member.id) ?? 0) < 0 &&
      !nudgedMemberIds.includes(member.id),
  );

  const dateLabel = selectedDateChip
    ? monthDayLabel(selectedDateChip.month, selectedDateChip.day, ACTIVE_LOCALE)
    : monthDayLabel(new Date().getMonth() + 1, new Date().getDate(), ACTIVE_LOCALE);

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

        {emptyGroup ? (
          // A brand new group: nothing recorded, nobody else here yet. The
          // balance card would say 已結清 (technically true, meaningless),
          // the member list would be one row (yourself), and every summary
          // row would be empty - none of that earns its place on screen yet.
          <div className="home-empty-actions">
            <button className="primary-action" type="button" onClick={onOpenExpenseComposer}>
              {text.addExpense}
            </button>
            <button className="secondary-action" type="button" onClick={onInviteMembers}>
              {text.inviteMembers}
            </button>
          </div>
        ) : (
          <>
            <BalanceCard currency={group.currency} myBalanceMinor={myBalanceMinor} debtors={debtors} groupSettled={groupSettled} />

            <div className="home-member-list" id="group-members" aria-label={text.members}>
              {rowMembers.map((member) => {
                const isSelf = member.id === currentMember?.id;
                const settleIntent =
                  currentMember && !isSelf
                    ? settlementBetween(
                        { id: currentMember.id, balanceMinor: balances.get(currentMember.id) ?? 0 },
                        { id: member.id, balanceMinor: balances.get(member.id) ?? 0 },
                      )
                    : null;
                const nudgeable = !member.virtual && !isSelf && (balances.get(member.id) ?? 0) < 0;
                const nudged = nudgedMemberIds.includes(member.id);
                return (
                  <MemberRow
                    key={member.id}
                    member={member}
                    currency={group.currency}
                    balanceMinor={balances.get(member.id) ?? 0}
                    expanded={expandedMemberId === member.id}
                    onToggle={() => setExpandedMemberId((current) => (current === member.id ? null : member.id))}
                    settleIntent={settleIntent}
                    nudgeable={nudgeable}
                    nudged={nudged}
                    pendingAction={pendingAction}
                    onSettle={(intent) => onSettleTransfer(intent.fromMemberId, intent.toMemberId, intent.amountMinor)}
                    onNudge={onNudgeMember}
                    onViewDetail={() => onOpenDialog("memberList")}
                  />
                );
              })}
              {/* Deliberately not `.member-row` - a count of ".member-row"
                  is a count of actual members, and these two rows aren't
                  one. */}
              {crowded ? (
                <div className="member-row-extra">
                  <button className="member-row-head member-row-more" type="button" onClick={() => onOpenDialog("memberList")}>
                    <span className="member-row-icon" aria-hidden="true">
                      <ChevronRight size={18} />
                    </span>
                    <span className="member-row-name">
                      <strong>{text.viewAll}</strong>
                    </span>
                  </button>
                </div>
              ) : null}
              <div className="member-row-extra">
                <button className="member-row-head member-row-add" type="button" onClick={() => onOpenDialog("memberActions")}>
                  <span className="member-row-icon" aria-hidden="true">
                    <Plus size={19} />
                  </span>
                  <span className="member-row-name">
                    <strong>{text.addMember}</strong>
                  </span>
                </button>
              </div>
            </div>

            {nudgeTargets.length ? (
              <button
                className="primary-action home-nudge-all"
                type="button"
                disabled={pendingAction === "nudgeAll"}
                onClick={() => onNudgeAll(nudgeTargets)}
              >
                {pendingAction === "nudgeAll" ? text.processing : `${text.nudge} ${nudgeTargets.length} ${text.people}`}
              </button>
            ) : null}
          </>
        )}
      </article>

      {emptyGroup ? null : (
        <>
          <HomeDisclosure
            key={`records-${group.id}`}
            id="group-records"
            label={text.records}
            summary={expenses.length ? `${expenseCount} · ${formatAmount(expenses[0].amountMinor, expenses[0].currency)}` : text.noRecords}
            headExtra={
              <>
                {/* The disclosure's own body only ever shows the last 5 -
                    this is the way to the full, searchable history (see
                    RecordsPanel, opened the same way from the bottom nav). */}
                <button className="text-action" type="button" onClick={() => onOpenDialog("recordsPanel")}>
                  {text.viewAll}
                </button>
                <button className="icon-action" type="button" aria-label={text.scanReceipt} onClick={onScanReceipt}>
                  <Scan aria-hidden="true" size={18} />
                </button>
              </>
            }
          >
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
          </HomeDisclosure>

          {/* 首頁拿不到「整月」金額 (aggregates.spendByDay is an 8-day rolling
              window, and the true month/period totals live behind
              useSpendBreakdown, which only fetches while the analysis panel
              is open - opening it here would cost every group visit an extra
              request). So this row doesn't claim to be "this month": it's the
              same 個人消費/群組消費 + date-chip picker the card always had,
              just folded into a disclosure and labelled honestly. Hidden
              below 3 records for the same reason the original spec gave -
              there's no comparison to make yet. */}
          {expenses.length >= 3 ? (
            <HomeDisclosure
              key={`analysis-${group.id}`}
              id="group-analysis"
              label={spendTab === "group" ? text.groupSpend : text.personalSpend}
              summary={`${dateLabel} ${formatAmount(spendDisplayAmountMinor, group.currency)}`}
            >
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
              <div className="spending-date-row">
                <div>
                  <span>{dateLabel}</span>
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
            </HomeDisclosure>
          ) : null}

          {activities.length ? (
            <HomeDisclosure key={`activity-${group.id}`} label={text.recentActivity} summary={activities[0].text}>
              <div className="pizo-activity-list">
                {activities.slice(0, 5).map((activity) => (
                  <div className="activity-row pizo-activity-row" key={activity.id}>
                    <strong>{activity.text}</strong>
                    <span>{formatActivityTime(activity.createdAt)}</span>
                  </div>
                ))}
              </div>
            </HomeDisclosure>
          ) : null}
        </>
      )}
    </section>
  );
}
