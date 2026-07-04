import { useMemo, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import type { Member } from "./appTypes";
import { COMPOSER_MODES, getComposerSubmitState, type ComposerMode } from "./expenseComposer";
import { convertToGroupAmountMinor } from "./expenseCurrency";
import { canSubmitExpenseDraft } from "./expenseDraft";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import { buildEqualShareAmountsMinor, getCustomSplitRemainderMinor } from "./expenseShareSplit";
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

function initial(name: string | undefined) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function formatTwd(amountMinor: number) {
  return `$${Math.round(amountMinor / 100).toLocaleString("zh-TW")}`;
}

export type ExpenseDraft = {
  title: string;
  amountMinor: number;
  createdAt: string;
  payerId: string;
  shareMemberIds: string[];
  category: string;
  note?: string;
  imageDataUrl?: string;
  shareAmountsMinor?: Record<string, number>;
  sourceCurrency?: string;
  sourceAmountMinor?: number;
  exchangeRate?: number;
};

export function ExpenseComposerSheet({
  members,
  groupCurrency,
  currencyOptions,
  onClose,
  onSubmit,
  onImageError,
}: {
  members: Member[];
  groupCurrency: string;
  currencyOptions: Array<{ code: string; label: string }>;
  onClose: () => void;
  onSubmit: (draft: ExpenseDraft) => void;
  onImageError?: () => void;
}) {
  const [composerMode, setComposerMode] = useState<ComposerMode>("expense");
  const [composerCategory, setComposerCategory] = useState<string>("general");
  const [composerDateTime, setComposerDateTime] = useState<string>(() => toLocalDateTimeInputValue(new Date().toISOString()));
  const [composerCurrency, setComposerCurrency] = useState<string>(groupCurrency);
  const [composerExchangeRate, setComposerExchangeRate] = useState<string>("1");
  const [composerTitle, setComposerTitle] = useState<string>("");
  const [composerAmount, setComposerAmount] = useState("");
  const [composerPayerId, setComposerPayerId] = useState(members[0]?.id ?? "");
  const [composerShareIds, setComposerShareIds] = useState<string[]>(members.map((member) => member.id));
  const [composerPayerExpanded, setComposerPayerExpanded] = useState(false);
  const [composerCustomSplit, setComposerCustomSplit] = useState(false);
  const [composerShareAmounts, setComposerShareAmounts] = useState<Record<string, string>>({});
  const [composerImageDataUrl, setComposerImageDataUrl] = useState<string>("");
  const [composerNote, setComposerNote] = useState("");

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
  const composerSubmitState = getComposerSubmitState({
    mode: composerMode,
    canSubmitExpense: canSubmitExpenseDraft({
      amount: composerAmount,
      selectedShareMemberCount: composerShareIds.length,
      isCustomSplit: composerCustomSplit,
      totalAmountMinor: composerTotalAmountMinor,
      shareAmountsMinor: composerCustomShareAmountsMinor,
    }),
  });
  const composerRemainderMinor = getCustomSplitRemainderMinor({
    totalAmountMinor: composerTotalAmountMinor,
    shareAmountsMinor: composerCustomShareAmountsMinor,
  });
  const composerPayer = members.find((member) => member.id === composerPayerId) ?? members[0];

  function toggleComposerShareMember(memberId: string) {
    setComposerShareIds((current) => {
      if (current.includes(memberId)) {
        if (current.length <= 1) return current;
        return current.filter((id) => id !== memberId);
      }
      return [...current, memberId];
    });
  }

  function toggleComposerCustomSplit() {
    setComposerCustomSplit((current) => {
      const next = !current;
      if (next) {
        const equalShares = buildEqualShareAmountsMinor(composerShareIds, composerTotalAmountMinor);
        const nextShareAmounts: Record<string, string> = {};
        composerShareIds.forEach((id) => {
          nextShareAmounts[id] = (((equalShares[id] ?? 0) / 100).toFixed(2)).replace(/\.00$/, "");
        });
        setComposerShareAmounts(nextShareAmounts);
      }
      return next;
    });
  }

  function resetComposerSplitEvenly() {
    const equalShares = buildEqualShareAmountsMinor(composerShareIds, composerTotalAmountMinor);
    const nextShareAmounts: Record<string, string> = {};
    composerShareIds.forEach((id) => {
      nextShareAmounts[id] = (((equalShares[id] ?? 0) / 100).toFixed(2)).replace(/\.00$/, "");
    });
    setComposerShareAmounts(nextShareAmounts);
  }

  async function handleComposerImagePick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      setComposerImageDataUrl(dataUrl);
    } catch {
      onImageError?.();
    }
  }

  function submitExpense() {
    if (members.length === 0) return;
    const totalAmountMinor = composerNeedsExchangeRate
      ? convertToGroupAmountMinor({ amount: composerAmount, exchangeRate: composerExchangeRate })
      : Math.round((Number(composerAmount) || 0) * 100);
    const customShareAmountsMinor: Record<string, number> = {};
    composerShareIds.forEach((id) => {
      customShareAmountsMinor[id] = Math.round((Number(composerShareAmounts[id]) || 0) * 100);
    });
    if (
      !canSubmitExpenseDraft({
        amount: composerAmount,
        selectedShareMemberCount: composerShareIds.length,
        isCustomSplit: composerCustomSplit,
        totalAmountMinor,
        shareAmountsMinor: customShareAmountsMinor,
      })
    ) {
      return;
    }
    const createdAt = composerDateTime ? new Date(composerDateTime).toISOString() : new Date().toISOString();
    const payerId = composerPayerId || members[0].id;
    const shareMemberIds = composerShareIds.length ? composerShareIds : members.map((member) => member.id);
    const categoryLabel = UI_TEXT.categories[composerCategory as keyof typeof UI_TEXT.categories] ?? UI_TEXT.categories.general;
    const draft: ExpenseDraft = {
      title: composerTitle.trim() || categoryLabel,
      amountMinor: totalAmountMinor,
      createdAt,
      payerId,
      shareMemberIds,
      category: composerCategory,
      note: composerNote.trim() || undefined,
      imageDataUrl: composerImageDataUrl || undefined,
      shareAmountsMinor: composerCustomSplit ? customShareAmountsMinor : undefined,
    };
    if (composerNeedsExchangeRate) {
      draft.sourceCurrency = composerCurrency;
      draft.sourceAmountMinor = Math.round((Number(composerAmount) || 0) * 100);
      draft.exchangeRate = Number(composerExchangeRate) || 1;
    }
    onSubmit(draft);
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
          <h2>{text.addExpense}</h2>
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

        {composerMode === "expense" ? (
          <>
            <div className="composer-meta-grid">
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
                placeholder={text.titlePlaceholder}
                aria-label={text.title}
              />
            </label>

            <div className="composer-card-section">
              <button className="composer-payer-summary" type="button" onClick={() => setComposerPayerExpanded((current) => !current)}>
                <span className="composer-section-head-label">{text.payer}</span>
                <span className="composer-payer-summary-value">
                  <span className="member-avatar">{initial(composerPayer?.name)}</span>
                  <strong>{composerPayer?.name ?? ""}</strong>
                  <ChevronRight aria-hidden="true" size={16} className={composerPayerExpanded ? "chevron rotated" : "chevron"} />
                </span>
              </button>
              {composerPayerExpanded ? (
                <div className="payer-chip-grid">
                  {members.map((member) => (
                    <button
                      className={member.id === composerPayerId ? "payer-chip active" : "payer-chip"}
                      type="button"
                      key={member.id}
                      onClick={() => {
                        setComposerPayerId(member.id);
                        setComposerPayerExpanded(false);
                      }}
                    >
                      <span className="member-avatar">{initial(member.name)}</span>
                      <strong>{member.name}</strong>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="composer-card-section">
              <div className="composer-section-head">
                <span>{text.whoPays}</span>
                <button className="text-action" type="button" onClick={toggleComposerCustomSplit}>
                  {text.allocationSettings}
                </button>
              </div>
              <div className="share-member-list">
                {members.map((member) => {
                  const included = composerShareIds.includes(member.id);
                  const displayAmountMinor = included
                    ? composerCustomSplit
                      ? Math.round((Number(composerShareAmounts[member.id]) || 0) * 100)
                      : composerEqualShareAmountsMinor[member.id] ?? 0
                    : 0;
                  return (
                    <div className={included ? "share-member-row" : "share-member-row dimmed"} key={member.id}>
                      <button
                        className="share-member-toggle"
                        type="button"
                        onClick={() => toggleComposerShareMember(member.id)}
                      >
                        <span className="member-avatar">{initial(member.name)}</span>
                        <strong>{member.name}</strong>
                      </button>
                      {composerCustomSplit && included ? (
                        <input
                          className="share-member-amount-input"
                          value={composerShareAmounts[member.id] ?? ""}
                          onChange={(event) =>
                            setComposerShareAmounts((current) => ({ ...current, [member.id]: event.target.value }))
                          }
                          inputMode="decimal"
                          aria-label={`${member.name} ${text.amount}`}
                        />
                      ) : (
                        <span className="share-member-amount">{formatTwd(displayAmountMinor)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {composerCustomSplit ? (
                <div className="composer-split-footer">
                  <span>
                    {text.remainingAmount} {formatTwd(composerRemainderMinor)}
                  </span>
                  <button className="composer-mini-action" type="button" onClick={resetComposerSplitEvenly}>
                    {text.splitEvenly}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="composer-card-section composer-photo-note-row">
              <div className="composer-photo-picker">
                <span className="composer-section-head-label">{text.photo}</span>
                {composerImageDataUrl ? (
                  <div className="composer-photo-preview">
                    <img src={composerImageDataUrl} alt="" />
                    <button
                      className="composer-photo-remove"
                      type="button"
                      aria-label={text.removePhoto}
                      onClick={() => setComposerImageDataUrl("")}
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
          </>
        ) : null}

        <p className="composer-hint">{composerSubmitState.hint}</p>

        <button className="composer-submit-full" type="button" disabled={composerSubmitState.disabled} onClick={submitExpense}>
          {composerSubmitState.label}
        </button>
      </section>
    </div>
  );
}
