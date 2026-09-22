// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExpenseDetailDialog } from "./ExpenseDetailDialog";
import type { Expense, Member } from "./appTypes";
import type { ExpenseCommentsState } from "./useExpenseComments";
import { UI_TEXT } from "./uiText";

const detailText = UI_TEXT.expenseDetail;

// No vitest setup file in this project, so auto-cleanup is not wired up and
// each render would stack another dialog into the same document.
afterEach(cleanup);

const members: Member[] = [
  { id: "member_a", name: "Alice" },
  { id: "member_b", name: "Bob" },
];

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense_1",
    title: "晚餐",
    amountMinor: 100000,
    currency: "TWD",
    createdAt: "2026-08-26T02:00:00.000Z",
    payerId: "member_a",
    shareMemberIds: ["member_a", "member_b"],
    kind: "expense",
    category: "food",
    shareAmountsMinor: { member_a: 50000, member_b: 50000 },
    payments: [{ payerId: "member_a", amountMinor: 100000 }],
    ...overrides,
  };
}

function commentsState(overrides: Partial<ExpenseCommentsState> = {}): ExpenseCommentsState {
  return {
    items: [],
    loading: false,
    error: null,
    submitting: false,
    submit: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

function comment(id: string, memberId: string, body: string) {
  return { id, expense_id: "expense_1", member_id: memberId, body, created_at: "2026-08-26T02:05:00.000Z" };
}

function renderDialog(props: Partial<Parameters<typeof ExpenseDetailDialog>[0]> = {}) {
  return render(
    <ExpenseDetailDialog
      expense={expense()}
      members={members}
      onClose={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  );
}

describe("receipts", () => {
  test("shows every receipt, not just the first", () => {
    renderDialog({
      expense: expense({
        imageUrl: "https://cdn/a.jpg",
        imageUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"],
      }),
    });

    expect(screen.getByRole("button", { name: `${detailText.viewImage} 1` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${detailText.viewImage} 3` })).toBeTruthy();
  });

  test("a single receipt keeps its unnumbered label", () => {
    renderDialog({ expense: expense({ imageUrl: "https://cdn/a.jpg", imageUrls: ["https://cdn/a.jpg"] }) });
    expect(screen.getByRole("button", { name: detailText.viewImage })).toBeTruthy();
  });

  test("still renders an entry that predates the list, from its single imageUrl", () => {
    // A cached bundle or an older server sends image_url alone. Dropping the
    // photo because the array is missing would look like losing the receipt.
    renderDialog({ expense: expense({ imageUrl: "https://cdn/legacy.jpg" }) });
    expect(screen.getByRole("button", { name: detailText.viewImage })).toBeTruthy();
  });

  test("opens the lightbox on the receipt that was tapped, not always the first", () => {
    renderDialog({
      expense: expense({ imageUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg"] }),
    });

    fireEvent.click(screen.getByRole("button", { name: `${detailText.viewImage} 2` }));

    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  test("pages between receipts without closing the lightbox", () => {
    renderDialog({
      expense: expense({ imageUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg"] }),
    });

    fireEvent.click(screen.getByRole("button", { name: `${detailText.viewImage} 1` }));
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: detailText.nextImage }));
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  test("a single receipt gets no paging chrome", () => {
    renderDialog({ expense: expense({ imageUrls: ["https://cdn/a.jpg"] }) });
    fireEvent.click(screen.getByRole("button", { name: detailText.viewImage }));

    expect(screen.queryByRole("button", { name: detailText.nextImage })).toBeNull();
  });

  test("a settlement shows no receipts at all", () => {
    renderDialog({
      expense: expense({ kind: "settlement", transferToMemberId: "member_b", imageUrls: ["https://cdn/a.jpg"] }),
    });

    expect(screen.queryByRole("button", { name: detailText.viewImage })).toBeNull();
  });
});

describe("comments", () => {
  test("renders no thread at all when the caller passes none", () => {
    // A caller without a cloud session gets a dialog with no comment section,
    // rather than an empty one implying the thread is empty.
    renderDialog();
    expect(screen.queryByRole("region", { name: detailText.comments })).toBeNull();
  });

  test("says the thread is empty rather than showing nothing", () => {
    renderDialog({ comments: commentsState() });
    expect(screen.getByText(detailText.commentsEmpty)).toBeTruthy();
  });

  test("resolves the author from the member list, so a rename shows through", () => {
    renderDialog({ comments: commentsState({ items: [comment("c1", "member_b", "這筆我請")] }) });

    // Scoped to the thread: Bob is also in the split list above it.
    const thread = screen.getByRole("region", { name: detailText.comments });
    expect(within(thread).getByText("Bob")).toBeTruthy();
    expect(within(thread).getByText("這筆我請")).toBeTruthy();
  });

  test("names a comment from someone no longer in the group rather than leaving it blank", () => {
    renderDialog({ comments: commentsState({ items: [comment("c1", "member_gone", "我先付")] }) });
    expect(screen.getByText(detailText.commentsUnknownMember)).toBeTruthy();
  });

  test("sends a trimmed comment and clears the box", () => {
    const submit = vi.fn(async () => {});
    renderDialog({ comments: commentsState({ submit }) });

    const input = screen.getByRole("textbox", { name: detailText.comments }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  我付的  " } });
    fireEvent.click(screen.getByRole("button", { name: detailText.commentSubmit }));

    expect(submit).toHaveBeenCalledWith("我付的");
    expect(input.value).toBe("");
  });

  test("will not send an empty comment", () => {
    const submit = vi.fn(async () => {});
    renderDialog({ comments: commentsState({ submit }) });

    fireEvent.change(screen.getByRole("textbox", { name: detailText.comments }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: detailText.commentSubmit })).toHaveProperty("disabled", true);
    expect(submit).not.toHaveBeenCalled();
  });

  test("offers to withdraw your own comment but not somebody else's", () => {
    renderDialog({
      currentMemberId: "member_a",
      comments: commentsState({
        items: [comment("c1", "member_a", "我的"), comment("c2", "member_b", "別人的")],
      }),
    });

    const thread = screen.getByRole("region", { name: detailText.comments });
    const removes = within(thread).getAllByRole("button", { name: new RegExp(detailText.commentDelete) });
    expect(removes).toHaveLength(1);
    expect(removes[0].getAttribute("aria-label")).toContain("我的");
  });

  test("the group owner can withdraw anybody's, because nobody else can", () => {
    renderDialog({
      currentMemberId: "member_a",
      isGroupOwner: true,
      comments: commentsState({
        items: [comment("c1", "member_a", "我的"), comment("c2", "member_b", "別人的")],
      }),
    });

    const thread = screen.getByRole("region", { name: detailText.comments });
    expect(within(thread).getAllByRole("button", { name: new RegExp(detailText.commentDelete) })).toHaveLength(2);
  });

  test("a failed action is announced, not swallowed", () => {
    renderDialog({ comments: commentsState({ error: "網路連線失敗" }) });
    expect(screen.getByRole("alert").textContent).toContain("網路連線失敗");
  });
});

describe("ExpenseDetailDialog in a personal ledger", () => {
  const app = UI_TEXT.app;

  // [MV]
  test("hides the payer and share-breakdown blocks for an expense", () => {
    renderDialog({ personal: true });

    expect(screen.queryByText(app.payerLabel)).toBeNull();
    expect(screen.queryByText(app.shareBreakdown)).toBeNull();
  });

  // [MV]
  test("hides the collector and beneficiary blocks for income", () => {
    renderDialog({
      personal: true,
      expense: expense({
        kind: "income",
        payerId: "member_a",
        shareMemberIds: ["member_a"],
        payments: [{ payerId: "member_a", amountMinor: 100000 }],
      }),
    });

    expect(screen.queryByText(app.incomeCollector)).toBeNull();
    expect(screen.queryByText(app.incomeBeneficiaries)).toBeNull();
  });

  test("a shared-group render (personal omitted) still shows the payer and share blocks", () => {
    renderDialog();

    expect(screen.getByText(app.payerLabel)).toBeTruthy();
    expect(screen.getByText(app.shareBreakdown)).toBeTruthy();
  });
});
