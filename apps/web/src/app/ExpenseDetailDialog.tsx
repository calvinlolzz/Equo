import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { Expense, Member } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;
const detailText = UI_TEXT.expenseDetail;

function initial(name: string | undefined) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function formatTwd(amountMinor: number) {
  return `$${Math.round(amountMinor / 100).toLocaleString("zh-TW")}`;
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
  onDelete,
}: {
  expense: Expense;
  members: Member[];
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isSettlement = expense.kind === "settlement";
  const payer = members.find((member) => member.id === expense.payerId);
  const recipient = members.find((member) => member.id === expense.shareMemberIds[0]);
  const categoryLabel = expense.category
    ? UI_TEXT.categories[expense.category as keyof typeof UI_TEXT.categories] ?? UI_TEXT.categories.general
    : UI_TEXT.categories.general;
  const shareMembers = members.filter((member) => expense.shareMemberIds.includes(member.id));

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete(expense);
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flow-dialog expense-detail-dialog glass-panel" role="dialog" aria-modal="true" aria-label={isSettlement ? detailText.settlementTitle : detailText.title}>
        <button className="dialog-close" type="button" aria-label={text.cancel} onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>

        {!isSettlement && expense.imageDataUrl ? (
          <div className="expense-detail-image">
            <img src={expense.imageDataUrl} alt="" />
          </div>
        ) : null}

        <div className="dialog-header">
          <h3>{expense.title}</h3>
          {!isSettlement ? <p>{categoryLabel}</p> : null}
        </div>

        {isSettlement ? (
          <div className="expense-detail-settlement-row">
            <div className="expense-detail-person">
              <span className="member-avatar lime">{initial(payer?.name)}</span>
              <strong>{payer?.name ?? ""}</strong>
              <small>{detailText.from}</small>
            </div>
            <b>{"→"}</b>
            <div className="expense-detail-person">
              <span className="member-avatar photo">{initial(recipient?.name)}</span>
              <strong>{recipient?.name ?? ""}</strong>
              <small>{detailText.to}</small>
            </div>
          </div>
        ) : null}

        <div className="expense-detail-stat-grid">
          <div>
            <span>{text.amount}</span>
            <strong>{formatTwd(expense.amountMinor)}</strong>
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

        {!isSettlement ? (
          <div className="dialog-section-list">
            <span className="dialog-list-title">{text.payerLabel}</span>
            <div className="member-dialog-row expense-detail-payer-row">
              <span className="member-avatar">{initial(payer?.name)}</span>
              <span>
                <strong>{payer?.name ?? ""}</strong>
              </span>
            </div>
          </div>
        ) : null}

        {!isSettlement ? (
          <div className="dialog-section-list">
            <span className="dialog-list-title">{text.shareBreakdown}</span>
            {shareMembers.map((member) => (
              <div className="member-dialog-row" key={member.id}>
                <span className="member-avatar">{initial(member.name)}</span>
                <span>
                  <strong>{member.name}</strong>
                </span>
                <b>{formatTwd(getMemberShareMinor(expense, member.id))}</b>
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

        <div className="dialog-action-row">
          {!isSettlement ? (
            <button className="secondary-action" type="button" onClick={() => onEdit(expense)}>
              <Pencil aria-hidden="true" size={16} />
              {text.editExpenseAction}
            </button>
          ) : null}
          <button className="danger-action" type="button" onClick={handleDeleteClick}>
            <Trash2 aria-hidden="true" size={16} />
            {confirmingDelete ? text.confirmDelete : text.deleteExpense}
          </button>
        </div>
      </section>
    </div>
  );
}
