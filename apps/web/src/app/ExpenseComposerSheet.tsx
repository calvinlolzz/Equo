import { useMemo, useRef, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import type { Expense, Member } from "./appTypes";
import { COMPOSER_MODES, getComposerSubmitState, type ComposerMode } from "./expenseComposer";
import { convertToGroupAmountMinor } from "./expenseCurrency";
import { canSubmitExpenseDraft, canSubmitTransferDraft } from "./expenseDraft";
import { buildExpenseEditPrefill, type ComposerSplitMode } from "./expenseEditPrefill";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import { formatAmount } from "./formatAmount";
import {
  buildEqualShareAmountsMinor,
  buildPercentShareAmounts,
  getCustomSplitRemainderMinor,
  getPaymentsRemainderMinor,
  getPercentSplitRemainder,
} from "./expenseShareSplit";
import { MemberAvatar } from "./MemberAvatar";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function amountMinorToInputString(amountMinor: number) {
  return ((amountMinor / 100).toFixed(2)).replace(/\.00$/, "");
}

/** Trim float noise for the percent remainder display (e.g. 33.330000000000005 -> 33.33). */
function formatPercent(value: number) {
  return `${Number(value.toFixed(2))}%`;
}

/**
 * Equal percents that sum to EXACTLY 100 at two decimals (basis points +
 * floor/remainder, mirroring buildEqualShareAmountsMinor's pattern), used
 * to seed the 比例 inputs when switching into percent mode.
 */
function buildEqualPercentStrings(memberIds: string[]): Record<string, string> {
  if (memberIds.length === 0) return {};
  const baseBasisPoints = Math.floor(10000 / memberIds.length);
  const remainder = 10000 - baseBasisPoints * memberIds.length;
  const result: Record<string, string> = {};
  memberIds.forEach((memberId, index) => {
    const basisPoints = baseBasisPoints + (index < remainder ? 1 : 0);
    result[memberId] = (basisPoints / 100).toString();
  });
  return result;
}

/**
 * Composer-facing draft. Field semantics vary by kind (see cloudAdapters):
 * - kind "expense" (default): payerId/payments = who paid, shareMemberIds =
 *   who owes, shareAmountsMinor/sharePercents = the split.
 * - kind "income": payerId = the single collector who holds the money,
 *   shareMemberIds = the beneficiaries who own it, shareAmountsMinor/
 *   sharePercents = how it is divided among the beneficiaries.
 * - kind "transfer": payerId = the member handing money over (轉出),
 *   transferToMemberId = the recipient (轉入); shareMemberIds = [recipient].
 */
export type ExpenseDraft = {
  title: string;
  amountMinor: number;
  createdAt: string;
  payerId: string;
  shareMemberIds: string[];
  category: string;
  kind?: "expense" | "income" | "transfer";
  note?: string;
  imageDataUrl?: string;
  imageUrl?: string;
  shareAmountsMinor?: Record<string, number>;
  shareType?: "fixed" | "percent";
  sharePercents?: Record<string, number>;
  payments?: Array<{ payerId: string; amountMinor: number }>;
  transferToMemberId?: string;
  sourceCurrency?: string;
  sourceAmountMinor?: number;
  exchangeRate?: number;
};

type PayerRow = { key: number; payerId: string; amount: string };

export function ExpenseComposerSheet({
  members,
  groupCurrency,
  currencyOptions,
  initialExpense,
  onClose,
  onSubmit,
  onImageError,
}: {
  members: Member[];
  groupCurrency: string;
  currencyOptions: Array<{ code: string; label: string }>;
  initialExpense?: Expense;
  onClose: () => void;
  onSubmit: (draft: ExpenseDraft) => void | Promise<void>;
  onImageError?: () => void;
}) {
  const editPrefill = useMemo(
    () => (initialExpense ? buildExpenseEditPrefill(initialExpense, groupCurrency) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [composerMode, setComposerMode] = useState<ComposerMode>(editPrefill?.mode ?? "expense");
  const [composerCategory, setComposerCategory] = useState<string>(editPrefill?.category ?? "general");
  const [composerDateTime, setComposerDateTime] = useState<string>(() =>
    toLocalDateTimeInputValue(editPrefill?.dateTimeIso ?? new Date().toISOString()),
  );
  const [composerCurrency, setComposerCurrency] = useState<string>(editPrefill?.currency ?? groupCurrency);
  const [composerExchangeRate, setComposerExchangeRate] = useState<string>(editPrefill?.exchangeRate ?? "1");
  const [composerTitle, setComposerTitle] = useState<string>(editPrefill?.title ?? "");
  const [composerAmount, setComposerAmount] = useState(editPrefill?.amount ?? "");
  const [composerPayerId, setComposerPayerId] = useState(editPrefill?.payerId ?? members[0]?.id ?? "");
  const [composerTransferToId, setComposerTransferToId] = useState<string>(() => {
    if (editPrefill?.transferToMemberId) return editPrefill.transferToMemberId;
    const fromId = editPrefill?.payerId ?? members[0]?.id ?? "";
    return members.find((member) => member.id !== fromId)?.id ?? "";
  });
  const [composerShareIds, setComposerShareIds] = useState<string[]>(
    editPrefill?.shareMemberIds.length ? editPrefill.shareMemberIds : members.map((member) => member.id),
  );
  const [composerPayerExpanded, setComposerPayerExpanded] = useState(false);
  const [composerTransferToExpanded, setComposerTransferToExpanded] = useState(false);
  const [composerSplitMode, setComposerSplitMode] = useState<ComposerSplitMode>(editPrefill?.splitMode ?? "equal");
  const [composerShareAmounts, setComposerShareAmounts] = useState<Record<string, string>>(editPrefill?.shareAmounts ?? {});
  const [composerSharePercents, setComposerSharePercents] = useState<Record<string, string>>(
    editPrefill?.sharePercents ?? {},
  );
  const [composerPayerRows, setComposerPayerRows] = useState<PayerRow[]>(() =>
    (editPrefill?.payments ?? []).map((payment, index) => ({ key: index, payerId: payment.payerId, amount: payment.amount })),
  );
  const payerRowKeyRef = useRef(editPrefill?.payments.length ?? 0);
  const [composerImageDataUrl, setComposerImageDataUrl] = useState<string>("");
  const [composerImageUrl, setComposerImageUrl] = useState<string>(editPrefill?.imageUrl ?? "");
  const [composerNote, setComposerNote] = useState(editPrefill?.note ?? "");
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  // Synchronous double-submit guard: composerSubmitting is React state, so
  // two rapid clicks on the submit button can both read it as false before
  // the first click's setState commits. This ref is set/checked in the same
  // tick the click handler runs, closing that race.
  const composerSubmittingRef = useRef(false);

  const composerNeedsExchangeRate = composerCurrency !== groupCurrency;
  const composerTotalAmountMinor = composerNeedsExchangeRate
    ? convertToGroupAmountMinor({ amount: composerAmount, exchangeRate: composerExchangeRate })
    : Math.round((Number(composerAmount) || 0) * 100);
  const composerEqualShareAmountsMinor = useMemo(
    () => buildEqualShareAmountsMinor(composerShareIds, composerTotalAmountMinor),
    [composerShareIds, composerTotalAmountMinor],
  );
  const composerCustomShareAmountsMinor = useMemo(() => {
    const result: Record<string, number> = {};
    composerShareIds.forEach((id) => {
      result[id] = Math.round((Number(composerShareAmounts[id]) || 0) * 100);
    });
    return result;
  }, [composerShareIds, composerShareAmounts]);
  const composerSharePercentValues = useMemo(() => {
    const result: Record<string, number> = {};
    composerShareIds.forEach((id) => {
      result[id] = Number(composerSharePercents[id]) || 0;
    });
    return result;
  }, [composerShareIds, composerSharePercents]);
  const composerPercentPreviewAmountsMinor = useMemo(
    () => buildPercentShareAmounts(composerShareIds, composerSharePercentValues, composerTotalAmountMinor),
    [composerShareIds, composerSharePercentValues, composerTotalAmountMinor],
  );

  const isMultiPayer = composerPayerRows.length > 1;
  const composerPaymentAmountsMinor = useMemo(() => {
    const result: Record<string, number> = {};
    composerPayerRows.forEach((row) => {
      result[String(row.key)] = Math.round((Number(row.amount) || 0) * 100);
    });
    return result;
  }, [composerPayerRows]);
  const composerPaymentsRemainderMinor = getPaymentsRemainderMinor({
    totalAmountMinor: composerTotalAmountMinor,
    paymentAmountsMinor: composerPaymentAmountsMinor,
  });
  const composerRemainderMinor = getCustomSplitRemainderMinor({
    totalAmountMinor: composerTotalAmountMinor,
    shareAmountsMinor: composerCustomShareAmountsMinor,
  });
  const composerPercentRemainder = getPercentSplitRemainder(composerShareIds, composerSharePercentValues);

  const canSubmit =
    composerMode === "transfer"
      ? canSubmitTransferDraft({
          amount: composerAmount,
          fromMemberId: composerPayerId,
          toMemberId: composerTransferToId,
        })
      : canSubmitExpenseDraft({
          amount: composerAmount,
          selectedShareMemberCount: composerShareIds.length,
          totalAmountMinor: composerTotalAmountMinor,
          shareAmountsMinor: composerCustomShareAmountsMinor,
          splitMode: composerSplitMode,
          shareMemberIds: composerShareIds,
          sharePercents: composerSharePercentValues,
          paymentAmountsMinor: composerMode === "expense" && isMultiPayer ? composerPaymentAmountsMinor : undefined,
        });
  const composerSubmitState = getComposerSubmitState({
    mode: composerMode,
    canSubmit,
    isEditing: Boolean(initialExpense),
  });
  const composerPayer = members.find((member) => member.id === composerPayerId) ?? members[0];
  const composerTransferTo = members.find((member) => member.id === composerTransferToId) ?? null;

  function toggleComposerShareMember(memberId: string) {
    setComposerShareIds((current) => {
      if (current.includes(memberId)) {
        if (current.length <= 1) return current;
        return current.filter((id) => id !== memberId);
      }
      return [...current, memberId];
    });
  }

  function seedShareAmountsEvenly() {
    const equalShares = buildEqualShareAmountsMinor(composerShareIds, composerTotalAmountMinor);
    const nextShareAmounts: Record<string, string> = {};
    composerShareIds.forEach((id) => {
      nextShareAmounts[id] = amountMinorToInputString(equalShares[id] ?? 0);
    });
    setComposerShareAmounts(nextShareAmounts);
  }

  function seedSharePercentsEvenly() {
    setComposerSharePercents(buildEqualPercentStrings(composerShareIds));
  }

  function selectSplitMode(mode: ComposerSplitMode) {
    if (mode === composerSplitMode) return;
    if (mode === "amount") seedShareAmountsEvenly();
    if (mode === "percent") seedSharePercentsEvenly();
    setComposerSplitMode(mode);
  }

  function nextPayerRowKey() {
    payerRowKeyRef.current += 1;
    return payerRowKeyRef.current;
  }

  function addPayerRow() {
    if (composerPayerRows.length === 0) {
      const firstId = composerPayerId || members[0]?.id || "";
      const secondId = members.find((member) => member.id !== firstId)?.id ?? firstId;
      setComposerPayerRows([
        { key: nextPayerRowKey(), payerId: firstId, amount: composerAmount },
        { key: nextPayerRowKey(), payerId: secondId, amount: "" },
      ]);
      setComposerPayerExpanded(false);
      return;
    }
    const used = new Set(composerPayerRows.map((row) => row.payerId));
    const nextId = members.find((member) => !used.has(member.id))?.id ?? members[0]?.id ?? "";
    setComposerPayerRows([...composerPayerRows, { key: nextPayerRowKey(), payerId: nextId, amount: "" }]);
  }

  function removePayerRow(key: number) {
    const next = composerPayerRows.filter((row) => row.key !== key);
    if (next.length <= 1) {
      // Collapse back to the zero-effort single payer that auto-tracks the
      // total amount.
      if (next[0]) setComposerPayerId(next[0].payerId);
      setComposerPayerRows([]);
      return;
    }
    setComposerPayerRows(next);
  }

  function updatePayerRow(key: number, patch: Partial<Pick<PayerRow, "payerId" | "amount">>) {
    setComposerPayerRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleComposerImagePick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      setComposerImageDataUrl(dataUrl);
      setComposerImageUrl("");
    } catch {
      onImageError?.();
    }
  }

  function removeComposerImage() {
    setComposerImageDataUrl("");
    setComposerImageUrl("");
  }

  function buildDraft(): ExpenseDraft | null {
    if (members.length === 0 || !canSubmit) return null;
    const createdAt = composerDateTime ? new Date(composerDateTime).toISOString() : new Date().toISOString();

    let draft: ExpenseDraft;
    if (composerMode === "transfer") {
      draft = {
        title: composerTitle.trim() || text.transferDefaultTitle,
        amountMinor: composerTotalAmountMinor,
        createdAt,
        payerId: composerPayerId,
        shareMemberIds: [composerTransferToId],
        category: "general",
        kind: "transfer",
        transferToMemberId: composerTransferToId,
        note: composerNote.trim() || undefined,
        shareAmountsMinor: { [composerTransferToId]: composerTotalAmountMinor },
      };
    } else {
      const categoryLabel = UI_TEXT.categories[composerCategory as keyof typeof UI_TEXT.categories] ?? UI_TEXT.categories.general;
      draft = {
        title: composerTitle.trim() || categoryLabel,
        amountMinor: composerTotalAmountMinor,
        createdAt,
        payerId: composerPayerId || members[0].id,
        shareMemberIds: composerShareIds,
        category: composerCategory,
        kind: composerMode,
        note: composerNote.trim() || undefined,
        imageDataUrl: composerImageDataUrl || undefined,
        imageUrl: composerImageDataUrl ? undefined : composerImageUrl || undefined,
      };
      if (composerSplitMode === "amount") {
        draft.shareAmountsMinor = composerCustomShareAmountsMinor;
      } else if (composerSplitMode === "percent") {
        draft.shareType = "percent";
        draft.sharePercents = composerSharePercentValues;
      }
      if (composerMode === "expense" && isMultiPayer) {
        draft.payments = composerPayerRows.map((row) => ({
          payerId: row.payerId,
          amountMinor: Math.round((Number(row.amount) || 0) * 100),
        }));
      }
    }

    if (composerNeedsExchangeRate) {
      draft.sourceCurrency = composerCurrency;
      draft.sourceAmountMinor = Math.round((Number(composerAmount) || 0) * 100);
      draft.exchangeRate = Number(composerExchangeRate) || 1;
    }
    return draft;
  }

  async function submitComposer() {
    if (composerSubmittingRef.current) return;
    const draft = buildDraft();
    if (!draft) return;
    composerSubmittingRef.current = true;
    setComposerSubmitting(true);
    try {
      await onSubmit(draft);
    } finally {
      composerSubmittingRef.current = false;
      setComposerSubmitting(false);
    }
  }

  function renderMemberChipGrid(activeId: string, onPick: (memberId: string) => void) {
    return (
      <div className="payer-chip-grid">
        {members.map((member) => (
          <button
            className={member.id === activeId ? "payer-chip active" : "payer-chip"}
            type="button"
            key={member.id}
            onClick={() => onPick(member.id)}
          >
            <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
            <strong>{member.name}</strong>
          </button>
        ))}
      </div>
    );
  }

  function renderSinglePayerPicker(label: string) {
    return (
      <>
        <button className="composer-payer-summary" type="button" onClick={() => setComposerPayerExpanded((current) => !current)}>
          <span className="composer-section-head-label">{label}</span>
          <span className="composer-payer-summary-value">
            <MemberAvatar className="member-avatar" name={composerPayer?.name} avatarUrl={composerPayer?.avatarUrl} />
            <strong>{composerPayer?.name ?? ""}</strong>
            <ChevronRight aria-hidden="true" size={16} className={composerPayerExpanded ? "chevron rotated" : "chevron"} />
          </span>
        </button>
        {composerPayerExpanded
          ? renderMemberChipGrid(composerPayerId, (memberId) => {
              setComposerPayerId(memberId);
              setComposerPayerExpanded(false);
            })
          : null}
      </>
    );
  }

  function renderPayerSection() {
    if (composerMode === "income") {
      return <div className="composer-card-section">{renderSinglePayerPicker(text.incomeCollector)}</div>;
    }

    if (!isMultiPayer) {
      return (
        <div className="composer-card-section">
          {renderSinglePayerPicker(text.payer)}
          <div className="composer-split-footer">
            <span />
            <button className="composer-mini-action" type="button" onClick={addPayerRow}>
              {text.addPayer}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="composer-card-section">
        <div className="composer-section-head">
          <span>{text.payer}</span>
          <button className="text-action" type="button" onClick={addPayerRow}>
            {text.addPayer}
          </button>
        </div>
        <div className="share-member-list">
          {composerPayerRows.map((row) => {
            const rowMember = members.find((member) => member.id === row.payerId);
            return (
              <div className="share-member-row composer-payer-row" key={row.key}>
                <span className="composer-payer-row-member">
                  <MemberAvatar className="member-avatar" name={rowMember?.name} avatarUrl={rowMember?.avatarUrl} />
                  <select
                    className="composer-payer-row-select"
                    value={row.payerId}
                    onChange={(event) => updatePayerRow(row.key, { payerId: event.target.value })}
                    aria-label={text.payer}
                  >
                    {members.map((member) => (
                      <option value={member.id} key={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </span>
                <input
                  className="share-member-amount-input"
                  value={row.amount}
                  onChange={(event) => updatePayerRow(row.key, { amount: event.target.value })}
                  inputMode="decimal"
                  aria-label={`${rowMember?.name ?? ""} ${text.amount}`}
                />
                <button
                  className="composer-payer-row-remove"
                  type="button"
                  aria-label={text.removePayer}
                  onClick={() => removePayerRow(row.key)}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="composer-split-footer">
          <span>
            {text.remainingAmount} {formatAmount(composerPaymentsRemainderMinor, groupCurrency)}
          </span>
        </div>
      </div>
    );
  }

  function renderShareSection() {
    return (
      <div className="composer-card-section">
        <div className="composer-section-head">
          <span>{composerMode === "income" ? text.incomeBeneficiaries : text.whoPays}</span>
          <div className="split-mode-toggle" role="group" aria-label={text.allocationSettings}>
            <button
              className={composerSplitMode === "equal" ? "split-mode-option active" : "split-mode-option"}
              type="button"
              onClick={() => selectSplitMode("equal")}
            >
              {text.splitEvenly}
            </button>
            <button
              className={composerSplitMode === "amount" ? "split-mode-option active" : "split-mode-option"}
              type="button"
              onClick={() => selectSplitMode("amount")}
            >
              {text.splitByAmount}
            </button>
            <button
              className={composerSplitMode === "percent" ? "split-mode-option active" : "split-mode-option"}
              type="button"
              onClick={() => selectSplitMode("percent")}
            >
              {text.splitByPercent}
            </button>
          </div>
        </div>
        <div className="share-member-list">
          {members.map((member) => {
            const included = composerShareIds.includes(member.id);
            const displayAmountMinor = included ? composerEqualShareAmountsMinor[member.id] ?? 0 : 0;
            return (
              <div className={included ? "share-member-row" : "share-member-row dimmed"} key={member.id}>
                <button className="share-member-toggle" type="button" onClick={() => toggleComposerShareMember(member.id)}>
                  <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
                  <strong>{member.name}</strong>
                </button>
                {included && composerSplitMode === "amount" ? (
                  <input
                    className="share-member-amount-input"
                    value={composerShareAmounts[member.id] ?? ""}
                    onChange={(event) =>
                      setComposerShareAmounts((current) => ({ ...current, [member.id]: event.target.value }))
                    }
                    inputMode="decimal"
                    aria-label={`${member.name} ${text.amount}`}
                  />
                ) : included && composerSplitMode === "percent" ? (
                  <span className="share-percent-cell">
                    <small>{formatAmount(composerPercentPreviewAmountsMinor[member.id] ?? 0, groupCurrency)}</small>
                    <input
                      className="share-member-amount-input share-percent-input"
                      value={composerSharePercents[member.id] ?? ""}
                      onChange={(event) =>
                        setComposerSharePercents((current) => ({ ...current, [member.id]: event.target.value }))
                      }
                      inputMode="decimal"
                      aria-label={`${member.name} %`}
                    />
                    <small>%</small>
                  </span>
                ) : (
                  <span className="share-member-amount">{formatAmount(displayAmountMinor, groupCurrency)}</span>
                )}
              </div>
            );
          })}
        </div>
        {composerSplitMode === "amount" ? (
          <div className="composer-split-footer">
            <span>
              {text.remainingAmount} {formatAmount(composerRemainderMinor, groupCurrency)}
            </span>
            <button className="composer-mini-action" type="button" onClick={seedShareAmountsEvenly}>
              {text.splitEvenly}
            </button>
          </div>
        ) : null}
        {composerSplitMode === "percent" ? (
          <div className="composer-split-footer">
            <span>
              {text.remainingAmount} {formatPercent(composerPercentRemainder)}
            </span>
            <button className="composer-mini-action" type="button" onClick={seedSharePercentsEvenly}>
              {text.splitEvenly}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderTransferSection() {
    return (
      <>
        <div className="composer-card-section">
          <button
            className="composer-payer-summary"
            type="button"
            onClick={() => setComposerPayerExpanded((current) => !current)}
          >
            <span className="composer-section-head-label">{text.transferOut}</span>
            <span className="composer-payer-summary-value">
              <MemberAvatar className="member-avatar" name={composerPayer?.name} avatarUrl={composerPayer?.avatarUrl} />
              <strong>{composerPayer?.name ?? ""}</strong>
              <ChevronRight aria-hidden="true" size={16} className={composerPayerExpanded ? "chevron rotated" : "chevron"} />
            </span>
          </button>
          {composerPayerExpanded
            ? renderMemberChipGrid(composerPayerId, (memberId) => {
                setComposerPayerId(memberId);
                setComposerPayerExpanded(false);
              })
            : null}
        </div>
        <div className="composer-card-section">
          <button
            className="composer-payer-summary"
            type="button"
            onClick={() => setComposerTransferToExpanded((current) => !current)}
          >
            <span className="composer-section-head-label">{text.transferIn}</span>
            <span className="composer-payer-summary-value">
              <MemberAvatar className="member-avatar" name={composerTransferTo?.name} avatarUrl={composerTransferTo?.avatarUrl} />
              <strong>{composerTransferTo?.name ?? ""}</strong>
              <ChevronRight
                aria-hidden="true"
                size={16}
                className={composerTransferToExpanded ? "chevron rotated" : "chevron"}
              />
            </span>
          </button>
          {composerTransferToExpanded
            ? renderMemberChipGrid(composerTransferToId, (memberId) => {
                setComposerTransferToId(memberId);
                setComposerTransferToExpanded(false);
              })
            : null}
        </div>
      </>
    );
  }

  return (
    <div
      className="composer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="expense-composer expense-sheet glass-panel" role="dialog" aria-modal="true" aria-label={text.addExpense}>
        <div className="sheet-drag-handle" aria-hidden="true" />
        <div className="composer-header">
          <p className="eyebrow">Expense</p>
          <h2>{initialExpense ? text.editExpense : text.addExpense}</h2>
        </div>

        <div className="composer-type-row segmented-control" role="tablist" aria-label={text.addExpense}>
          <span
            className="segmented-pill"
            style={{ transform: `translateX(${COMPOSER_MODES.findIndex((mode) => mode.id === composerMode) * 100}%)` }}
            aria-hidden="true"
          />
          {COMPOSER_MODES.map((mode) => (
            <button
              key={mode.id}
              className={mode.id === composerMode ? "composer-type active" : "composer-type"}
              type="button"
              role="tab"
              aria-selected={mode.id === composerMode}
              onClick={() => setComposerMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="composer-meta-grid">
          {composerMode !== "transfer" ? (
            <label>
              <span>{text.category}</span>
              <select value={composerCategory} onChange={(event) => setComposerCategory(event.target.value)} aria-label={text.category}>
                {Object.entries(UI_TEXT.categories).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>{text.date}</span>
            <input
              type="datetime-local"
              value={composerDateTime}
              onChange={(event) => setComposerDateTime(event.target.value)}
              aria-label={text.date}
            />
          </label>
        </div>

        <div className="composer-amount-card">
          <select
            className="composer-currency-select"
            value={composerCurrency}
            onChange={(event) => setComposerCurrency(event.target.value)}
            aria-label={text.currency}
          >
            {currencyOptions.map((currency) => (
              <option value={currency.code} key={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
          <input
            value={composerAmount}
            onChange={(event) => setComposerAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label={text.amount}
          />
        </div>

        {composerNeedsExchangeRate ? (
          <div className="composer-exchange-row">
            <span>
              1 {composerCurrency} → {groupCurrency}
            </span>
            <input
              value={composerExchangeRate}
              onChange={(event) => setComposerExchangeRate(event.target.value)}
              inputMode="decimal"
              aria-label={text.exchangeRateLabel}
            />
          </div>
        ) : null}

        <label>
          <input
            value={composerTitle}
            onChange={(event) => setComposerTitle(event.target.value)}
            placeholder={composerMode === "transfer" ? text.transferDefaultTitle : text.titlePlaceholder}
            aria-label={text.title}
          />
        </label>

        {composerMode === "transfer" ? renderTransferSection() : renderPayerSection()}
        {composerMode !== "transfer" ? renderShareSection() : null}

        {composerMode !== "transfer" ? (
          <div className="composer-card-section composer-photo-note-row">
            <div className="composer-photo-picker">
              <span className="composer-section-head-label">{text.photo}</span>
              {composerImageDataUrl || composerImageUrl ? (
                <div className="composer-photo-preview">
                  <img src={composerImageDataUrl || composerImageUrl} alt="" />
                  <button
                    className="composer-photo-remove"
                    type="button"
                    aria-label={text.removePhoto}
                    onClick={removeComposerImage}
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </div>
              ) : (
                <label className="composer-photo-add">
                  <Plus aria-hidden="true" size={22} />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleComposerImagePick(event.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
            <label className="composer-note-field">
              <span>{text.note}</span>
              <input
                value={composerNote}
                onChange={(event) => setComposerNote(event.target.value)}
                placeholder={text.notePlaceholder}
                aria-label={text.note}
              />
            </label>
          </div>
        ) : (
          <div className="composer-card-section">
            <label className="composer-note-field">
              <span>{text.note}</span>
              <input
                value={composerNote}
                onChange={(event) => setComposerNote(event.target.value)}
                placeholder={text.notePlaceholder}
                aria-label={text.note}
              />
            </label>
          </div>
        )}

        <p className="composer-hint">{composerSubmitState.hint}</p>

        <button
          className="composer-submit-full"
          type="button"
          disabled={composerSubmitState.disabled || composerSubmitting}
          onClick={submitComposer}
        >
          {composerSubmitting ? text.savingChanges : composerSubmitState.label}
        </button>
      </section>
    </div>
  );
}
