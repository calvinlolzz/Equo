import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { ChevronLeft, ChevronRight, CopyPlus, Pencil, Send, Trash2, X } from "lucide-react";
import type { ExpenseCommentsState } from "./useExpenseComments";
import { MAX_COMMENT_LENGTH } from "../contracts/validation";
import { mergeRefs, useDialogChrome } from "./useDialogChrome";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import type { Expense, Member } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";
import { formatAmount } from "./formatAmount";
import { MemberAvatar } from "./MemberAvatar";
import { categoryLabel as lookupCategoryLabel } from "./catalog";
import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";

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
  comments,
  currentMemberId,
  isGroupOwner = false,
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
  /**
   * The comment thread, already loaded and wired by the caller. Absent means
   * the section is not rendered at all - which is what a caller without a cloud
   * session (and every test that only cares about the amounts) gets.
   */
  comments?: ExpenseCommentsState;
  /** This user's member id in this group, for "is this comment mine to withdraw". */
  currentMemberId?: string;
  /** Group owners can withdraw anybody's comment; the server enforces the same rule. */
  isGroupOwner?: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [viewingImage, setViewingImage] = useState(false);
  // Which receipt the lightbox is showing. Separate from viewingImage so
  // closing and reopening returns to the one that was tapped.
  const [viewingImageIndex, setViewingImageIndex] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  // Swipe-to-dismiss, and with it the slide-out: closing used to unmount this
  // sheet on the spot, which read as the screen blinking rather than the sheet
  // leaving. Every close path below goes through requestClose so the animation
  // is not something only the drag gesture gets.
  const swipe = useSwipeToDismiss(onClose);
  const chromeRef = useDialogChrome(swipe.requestClose);
  const dialogRef = useMemo(
    () => mergeRefs<HTMLElement>(swipe.dragProps.ref, chromeRef),
    [swipe.dragProps.ref, chromeRef],
  );

  // Every receipt on the entry, tolerating a row that predates the list (a
  // cached bundle, an older server) so its single photo still shows.
  const receipts = expense.imageUrls ?? (expense.imageUrl ? [expense.imageUrl] : []);

  // Reset the two-tap delete guard AND the image lightbox when swiping to a
  // neighbouring expense (prev/next changes the prop without remounting), so a
  // 確認刪除 armed on one expense can never carry over and delete a different one.
  useEffect(() => {
    setConfirmingDelete(false);
    setViewingImage(false);
    setViewingImageIndex(0);
    // A half-typed comment belongs to the entry it was being written about.
    setCommentDraft("");
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
      className={swipe.closing ? "modal-backdrop closing" : "modal-backdrop"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) swipe.requestClose();
      }}
    >
      <section
        className={
          swipe.closing
            ? "flow-dialog expense-detail-dialog glass-panel closing"
            : "flow-dialog expense-detail-dialog glass-panel"
        }
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        {...swipe.dragProps}
        ref={dialogRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button className="dialog-close" type="button" aria-label={text.cancel} onClick={swipe.requestClose}>
          <X aria-hidden="true" size={18} />
        </button>

        {!isSettlement && receipts.length > 0 ? (
          <div className={receipts.length > 1 ? "expense-detail-images multiple" : "expense-detail-images"}>
            {receipts.map((url, index) => (
              <button
                className="expense-detail-image"
                type="button"
                key={`${url.slice(0, 48)}-${index}`}
                // Numbered only when there is more than one, so the common case
                // keeps reading as plain 查看原圖 rather than 查看原圖 1.
                aria-label={receipts.length > 1 ? `${detailText.viewImage} ${index + 1}` : detailText.viewImage}
                onClick={() => {
                  setViewingImageIndex(index);
                  setViewingImage(true);
                }}
              >
                <img src={url} alt="" loading={index === 0 ? undefined : "lazy"} decoding="async" />
              </button>
            ))}
          </div>
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
            {`${text.exchangeRateSummary} ${expense.sourceCurrency} ${((expense.sourceAmountMinor ?? 0) / 100).toLocaleString(ACTIVE_LOCALE)} × ${expense.exchangeRate ?? 1}`}
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

        {comments ? (
          <section className="expense-comments" aria-label={detailText.comments}>
            <h4>
              {detailText.comments}
              {comments.items.length > 0 ? <span>{comments.items.length}</span> : null}
            </h4>

            {comments.loading ? <p className="expense-comments-note">{detailText.commentsLoading}</p> : null}
            {!comments.loading && comments.items.length === 0 ? (
              <p className="expense-comments-note">{detailText.commentsEmpty}</p>
            ) : null}
            {comments.error ? (
              <p className="expense-comments-note expense-comments-error" role="alert">
                {comments.error}
              </p>
            ) : null}

            <ul className="expense-comments-list">
              {comments.items.map((comment) => {
                const author = members.find((member) => member.id === comment.member_id);
                const mine = currentMemberId !== undefined && comment.member_id === currentMemberId;

                return (
                  <li key={comment.id}>
                    <MemberAvatar
                      className="member-avatar small"
                      name={author?.name}
                      avatarUrl={author?.avatarUrl}
                    />
                    <div>
                      <p className="expense-comment-head">
                        {/* A member who has left the group still wrote it, and
                            an unattributed line reads as the app losing track. */}
                        <strong>{author?.name ?? detailText.commentsUnknownMember}</strong>
                        <small>{formatDateTime(comment.created_at)}</small>
                      </p>
                      <p className="expense-comment-body">{comment.body}</p>
                    </div>
                    {mine || isGroupOwner ? (
                      <button
                        type="button"
                        className="expense-comment-remove"
                        aria-label={`${detailText.commentDelete}: ${comment.body.slice(0, 20)}`}
                        onClick={() => void comments.remove(comment.id)}
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <form
              className="expense-comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                const body = commentDraft.trim();
                if (!body) return;
                // Cleared before the request rather than after it. The thread is
                // the record; leaving the text sitting in the box while it flies
                // invites a second tap, and a failed send says so in the error
                // line above with the comment still recoverable from the thread
                // it never joined.
                setCommentDraft("");
                void comments.submit(body);
              }}
            >
              <input
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder={detailText.commentPlaceholder}
                aria-label={detailText.comments}
                maxLength={MAX_COMMENT_LENGTH}
              />
              <button type="submit" aria-label={detailText.commentSubmit} disabled={!commentDraft.trim() || comments.submitting}>
                <Send aria-hidden="true" size={16} />
              </button>
            </form>
          </section>
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
    {viewingImage && receipts[viewingImageIndex] ? (
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
        <img src={receipts[viewingImageIndex]} alt="" />
        {receipts.length > 1 ? (
          // stopPropagation on each: the backdrop closes the lightbox, and
          // paging through receipts must not also dismiss it.
          <div className="image-lightbox-nav" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={detailText.previousImage}
              disabled={viewingImageIndex === 0}
              onClick={() => setViewingImageIndex((index) => Math.max(0, index - 1))}
            >
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            <span>{`${viewingImageIndex + 1} / ${receipts.length}`}</span>
            <button
              type="button"
              aria-label={detailText.nextImage}
              disabled={viewingImageIndex === receipts.length - 1}
              onClick={() => setViewingImageIndex((index) => Math.min(receipts.length - 1, index + 1))}
            >
              <ChevronRight aria-hidden="true" size={20} />
            </button>
          </div>
        ) : null}
      </div>
    ) : null}
    </>
  );
}
