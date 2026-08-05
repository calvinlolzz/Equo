import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { CopyPlus, Pencil, Trash2, X } from "lucide-react";
import { useDialogChrome } from "./useDialogChrome";
import type { Expense, Member } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";
import { formatAmount } from "./formatAmount";
import { MemberAvatar } from "./MemberAvatar";
import { categoryLabel as lookupCategoryLabel } from "./catalog";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;
const detailText = UI_TEXT.expenseDetail;

/** Trim float noise so 33.330000000000005 renders as 33.33%. */
function formatPercentValue(value: number) {
  return `${Number(value.toFixed(2))}%`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

export function ExpenseDetailDialog({
  expense,
  members,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onPrev,
  onNext,
}: {
  expense: Expense;
  members: Member[];
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  /**
   * Reopen this entry as a new one. Absent for settlements — a 清償 records a
   * transfer that happened once, and "do it again" is not a shortcut anyone
   * wants one tap away from a balance.
   */
  onDuplicate?: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  /** Swipe-right target (previous/newer expense in the list). Absent = at the edge. */
  onPrev?: () => void;
  /** Swipe-left target (next/older expense in the list). Absent = at the edge. */
  onNext?: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [viewingImage, setViewingImage] = useState(false);
  const dialogRef = useDialogChrome(onClose);

  // Reset the two-tap delete guard AND the image lightbox when swiping to a
  // neighbouring expense (prev/next changes the prop without remounting), so a
  // 確認刪除 armed on one expense can never carry over and delete a different one.
  useEffect(() => {
    setConfirmingDelete(false);
    setViewingImage(false);
  }, [expense.id]);

  // Horizontal swipe flips between neighbouring expenses (mobile habit:
  // swipe left = next, swipe right = previous). Vertical-leaning drags are
  // ignored so the dialog's own scrolling is unaffected.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(event: ReactTouchEvent<HTMLElement>) {
    swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }

  function onTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const deltaX = event.changedTouches[0].clientX - start.x;
    const deltaY = event.changedTouches[0].clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
    if (deltaX < 0) {
      onNext?.();
    } else {
      onPrev?.();
    }
  }
  const isSettlement = expense.kind === "settlement";
  const isIncome = expense.kind === "income";
  const canDuplicate = !isSettlement && Boolean(onDuplicate);
  const payer = members.find((member) => member.id === expense.payerId);
  const recipient = members.find(
    (member) => member.id === (expense.transferToMemberId ?? expense.shareMemberIds[0]),
  );
  const categoryLabel = expense.category
    ? lookupCategoryLabel(expense.category)
    : lookupCategoryLabel("general");
  const shareMembers = members.filter((member) => expense.shareMemberIds.includes(member.id));
  // For income the "payments" are the beneficiaries' portions (分給誰); for
  // an expense they are the payers (付款人). Either way there is one row per
  // entry with its amount whenever there is more than one - a single-payer
  // expense keeps the original name-only row.
  const payments = expense.payments ?? [];
  const collector = isIncome ? members.find((member) => member.id === expense.shareMemberIds[0]) : null;
  const dialogTitle = isSettlement ? detailText.settlementTitle : isIncome ? detailText.incomeTitle : detailText.title;

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete(expense);
  }

  function renderShareAmount(memberId: string) {
    const shareMinor = getMemberShareMinor(expense, memberId);
    const percent = expense.shareType === "percent" ? expense.sharePercents?.[memberId] : undefined;
    if (typeof percent === "number") {
      return `${formatPercentValue(percent)}（${formatAmount(shareMinor, expense.currency)}）`;
    }
    return formatAmount(shareMinor, expense.currency);
  }

  return (
    <>
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flow-dialog expense-detail-dialog glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        ref={dialogRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button className="dialog-close" type="button" aria-label={text.cancel} onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>

        {!isSettlement && expense.imageUrl ? (
          <button className="expense-detail-image" type="button" aria-label={detailText.viewImage} onClick={() => setViewingImage(true)}>
            <img src={expense.imageUrl} alt="" />
          </button>
        ) : null}

        <div className="dialog-header">
          <h3>{expense.title}</h3>
          {!isSettlement ? <p>{categoryLabel}</p> : null}
        </div>

        {isSettlement ? (
          <div className="expense-detail-settlement-row">
            <div className="expense-detail-person">
              <MemberAvatar className="member-avatar lime" name={payer?.name} avatarUrl={payer?.avatarUrl} />
              <strong>{payer?.name ?? ""}</strong>
              <small>{detailText.from}</small>
            </div>
            <b>{"→"}</b>
            <div className="expense-detail-person">
              <MemberAvatar className="member-avatar photo" name={recipient?.name} avatarUrl={recipient?.avatarUrl} />
              <strong>{recipient?.name ?? ""}</strong>
              <small>{detailText.to}</small>
            </div>
          </div>
        ) : null}

        <div className="expense-detail-stat-grid">
          <div>
            <span>{text.amount}</span>
            <strong className={isIncome ? "amount-income" : undefined}>
              {isIncome ? `+${formatAmount(expense.amountMinor, expense.currency)}` : formatAmount(expense.amountMinor, expense.currency)}
            </strong>
          </div>
          <div>
            <span>{text.date}</span>
            <strong>{formatDateTime(expense.createdAt)}</strong>
          </div>
        </div>

        {!isSettlement && expense.sourceCurrency ? (
          <p className="expense-detail-source-line">
            {`${text.exchangeRateSummary} ${expense.sourceCurrency} ${((expense.sourceAmountMinor ?? 0) / 100).toLocaleString("zh-TW")} × ${expense.exchangeRate ?? 1}`}
          </p>
        ) : null}

        {isIncome ? (
          <>
            <div className="dialog-section-list">
              <span className="dialog-list-title">{text.incomeCollector}</span>
              <div className="member-dialog-row expense-detail-payer-row">
                <MemberAvatar className="member-avatar" name={collector?.name} avatarUrl={collector?.avatarUrl} />
                <span>
                  <strong>{collector?.name ?? ""}</strong>
                </span>
              </div>
            </div>
            <div className="dialog-section-list">
              <span className="dialog-list-title">{text.incomeBeneficiaries}</span>
              {payments.map((payment) => {
                const member = members.find((candidate) => candidate.id === payment.payerId);
                return (
                  <div className="member-dialog-row" key={payment.payerId}>
                    <MemberAvatar className="member-avatar" name={member?.name} avatarUrl={member?.avatarUrl} />
                    <span>
                      <strong>{member?.name ?? ""}</strong>
                    </span>
                    <b>{formatAmount(payment.amountMinor, expense.currency)}</b>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {!isSettlement && !isIncome ? (
          <div className="dialog-section-list">
            <span className="dialog-list-title">{text.payerLabel}</span>
            {payments.length > 1 ? (
              payments.map((payment) => {
                const member = members.find((candidate) => candidate.id === payment.payerId);
                return (
                  <div className="member-dialog-row" key={payment.payerId}>
                    <MemberAvatar className="member-avatar" name={member?.name} avatarUrl={member?.avatarUrl} />
                    <span>
                      <strong>{member?.name ?? ""}</strong>
                    </span>
                    <b>{formatAmount(payment.amountMinor, expense.currency)}</b>
                  </div>
                );
              })
            ) : (
              <div className="member-dialog-row expense-detail-payer-row">
                <MemberAvatar className="member-avatar" name={payer?.name} avatarUrl={payer?.avatarUrl} />
                <span>
                  <strong>{payer?.name ?? ""}</strong>
                </span>
              </div>
            )}
          </div>
        ) : null}

        {!isSettlement && !isIncome ? (
          <div className="dialog-section-list">
            <span className="dialog-list-title">{text.shareBreakdown}</span>
            {shareMembers.map((member) => (
              <div className="member-dialog-row" key={member.id}>
                <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
                <span>
                  <strong>{member.name}</strong>
                </span>
                <b>{renderShareAmount(member.id)}</b>
              </div>
            ))}
          </div>
        ) : null}

        {!isSettlement && expense.note ? (
          <div className="dialog-section-list">
            <span className="dialog-list-title">{text.note}</span>
            <p className="dialog-copy">{expense.note}</p>
          </div>
        ) : null}

        <div className={canDuplicate ? "dialog-action-row dialog-action-row--three" : "dialog-action-row"}>
          <button className="secondary-action" type="button" onClick={() => onEdit(expense)}>
            <Pencil aria-hidden="true" size={16} />
            {text.editExpenseAction}
          </button>
          {canDuplicate && onDuplicate ? (
            <button className="secondary-action" type="button" onClick={() => onDuplicate(expense)}>
              <CopyPlus aria-hidden="true" size={16} />
              {text.duplicateExpense}
            </button>
          ) : null}
          <button className="danger-action" type="button" onClick={handleDeleteClick}>
            <Trash2 aria-hidden="true" size={16} />
            {confirmingDelete ? text.confirmDelete : text.deleteExpense}
          </button>
        </div>
      </section>
    </div>
    {viewingImage && expense.imageUrl ? (
      <div
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={detailText.title}
        onClick={() => setViewingImage(false)}
      >
        <button className="image-lightbox-close" type="button" aria-label={detailText.closeImage}>
          <X aria-hidden="true" size={22} />
        </button>
        <img src={expense.imageUrl} alt="" />
      </div>
    ) : null}
    </>
  );
}
