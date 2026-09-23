// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CloudGroupsStore } from "./cloudStore";
import type { Expense, Group } from "./appTypes";
import type { ExpenseDraft } from "./ExpenseComposerSheet";
import type { ToastAction } from "./useToast";
import { useExpenseComposer } from "./useExpenseComposer";
import { UI_TEXT } from "./uiText";

const group: Group = { id: "group_1", name: "東京旅行", currency: "TWD" };

function draft(overrides: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    title: "午餐",
    amountMinor: 30000,
    createdAt: "2026-07-16T00:00:00.000Z",
    payerId: "member_alice",
    shareMemberIds: ["member_alice"],
    category: "food",
    ...overrides,
  };
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense_1",
    title: "舊的午餐",
    amountMinor: 30000,
    currency: "TWD",
    createdAt: "2026-07-15T00:00:00.000Z",
    payerId: "member_alice",
    shareMemberIds: ["member_alice"],
    ...overrides,
  };
}

function setup(overrides: {
  cloudStore?: Partial<CloudGroupsStore>;
  beginAction?: () => boolean;
  activeGroup?: Group | null;
} = {}) {
  const showToast = vi.fn();
  const recordCloudActivity = vi.fn();
  const beginAction = vi.fn(overrides.beginAction ?? (() => true));
  const endAction = vi.fn();
  const setDialog = vi.fn();
  const setBusy = vi.fn();
  const cloudStore = {
    addExpense: vi.fn(async () => {}),
    editExpense: vi.fn(async () => {}),
    deleteExpense: vi.fn(async () => {}),
    loadMoreExpenses: vi.fn(async () => {}),
    uploadGroupImage: vi.fn(async () => "https://cdn/img.png"),
    ...overrides.cloudStore,
  } as unknown as CloudGroupsStore;

  const hook = renderHook(() =>
    useExpenseComposer({
      activeGroup: overrides.activeGroup === undefined ? group : overrides.activeGroup,
      cloudStore,
      members: [],
      session: null,
      showToast,
      recordCloudActivity,
      beginAction,
      endAction,
      setDialog,
      setBusy,
    }),
  );

  return { hook, cloudStore, showToast, recordCloudActivity, beginAction, endAction, setDialog };
}

describe("useExpenseComposer", () => {
  test("opening the composer for a new expense clears any prior edit", () => {
    const { hook } = setup();

    act(() => hook.result.current.openExpenseEdit(expense()));
    expect(hook.result.current.editingExpense?.id).toBe("expense_1");

    act(() => hook.result.current.openExpenseComposer());
    expect(hook.result.current.editingExpense).toBeNull();
    expect(hook.result.current.expenseComposerOpen).toBe(true);
  });

  test("submitting a new draft adds the expense (not edits) and closes the composer", async () => {
    const { hook, cloudStore, recordCloudActivity, showToast } = setup();

    act(() => hook.result.current.openExpenseComposer());
    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(draft());
    });

    expect(cloudStore.addExpense).toHaveBeenCalledWith("group_1", draft(), "TWD");
    expect(cloudStore.editExpense).not.toHaveBeenCalled();
    expect(recordCloudActivity).toHaveBeenCalledWith("group_1", expect.stringContaining("午餐"));
    expect(hook.result.current.expenseComposerOpen).toBe(false);
    expect(showToast).toHaveBeenCalled();
  });

  test("submitting while editing replaces that expense (not a new add)", async () => {
    const { hook, cloudStore } = setup();

    act(() => hook.result.current.openExpenseEdit(expense()));
    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(draft({ title: "改過的午餐" }));
    });

    expect(cloudStore.editExpense).toHaveBeenCalledWith("group_1", "expense_1", draft({ title: "改過的午餐" }), "TWD");
    expect(cloudStore.addExpense).not.toHaveBeenCalled();
  });

  test("a draft with an image uploads it first and passes a URL, not the data URL", async () => {
    const { hook, cloudStore } = setup();

    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(draft({ imageDataUrls: ["data:image/png;base64,AAA"] }));
    });

    expect(cloudStore.uploadGroupImage).toHaveBeenCalledWith("group_1", "expense", "data:image/png;base64,AAA");
    const addArgs = (cloudStore.addExpense as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as ExpenseDraft;
    expect(addArgs.imageUrls).toEqual(["https://cdn/img.png"]);
    expect(addArgs.imageDataUrls).toEqual([]);
  });

  test("several picked photos are each uploaded, and stay in the order they were picked", async () => {
    let uploaded = 0;
    const { hook, cloudStore } = setup({
      cloudStore: {
        uploadGroupImage: vi.fn(async () => `https://cdn/img-${++uploaded}.png`),
      },
    });

    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(
        draft({ imageDataUrls: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"] }),
      );
    });

    expect(cloudStore.uploadGroupImage).toHaveBeenCalledTimes(2);
    const addArgs = (cloudStore.addExpense as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as ExpenseDraft;
    expect(addArgs.imageUrls).toEqual(["https://cdn/img-1.png", "https://cdn/img-2.png"]);
  });

  test("an edit keeps the receipts already on the entry and appends the newly picked one", async () => {
    const { hook, cloudStore } = setup();

    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(
        draft({ imageUrls: ["https://cdn/kept.png"], imageDataUrls: ["data:image/png;base64,AAA"] }),
      );
    });

    const addArgs = (cloudStore.addExpense as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as ExpenseDraft;
    expect(addArgs.imageUrls).toEqual(["https://cdn/kept.png", "https://cdn/img.png"]);
  });

  test("an image upload failure aborts without writing the expense", async () => {
    const { hook, cloudStore, showToast } = setup({
      cloudStore: {
        uploadGroupImage: vi.fn(async () => {
          throw new Error("upload failed");
        }),
      },
    });

    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(draft({ imageDataUrls: ["data:image/png;base64,AAA"] }));
    });

    expect(cloudStore.addExpense).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(UI_TEXT.app.imageUploadFailed);
  });

  test("deleting an expense offers an undo that re-creates it in the same group", async () => {
    const { hook, cloudStore, showToast } = setup();

    await act(async () => {
      await hook.result.current.deleteExpense(expense());
    });

    expect(cloudStore.deleteExpense).toHaveBeenCalledWith("group_1", "expense_1");

    // The toast carries an undo action; invoking it restores via addExpense -
    // same group, same currency, and the expense's own content.
    const action = (showToast.mock.calls.at(-1)?.[1] ?? undefined) as ToastAction | undefined;
    expect(action?.label).toBeTruthy();
    await act(async () => {
      action?.onAction();
    });
    expect(cloudStore.addExpense).toHaveBeenCalledWith(
      "group_1",
      expect.objectContaining({ title: "舊的午餐" }),
      "TWD",
    );
  });

  test("load-more delegates to the store when the guard permits", async () => {
    const { hook, cloudStore, endAction } = setup();

    await act(async () => {
      await hook.result.current.handleLoadMoreExpenses();
    });

    expect(cloudStore.loadMoreExpenses).toHaveBeenCalledWith("group_1");
    expect(endAction).toHaveBeenCalled();
  });

  test("load-more is gated by the action guard", async () => {
    const { hook, cloudStore } = setup({ beginAction: () => false });

    await act(async () => {
      await hook.result.current.handleLoadMoreExpenses();
    });

    // The guard refused, so no fetch went out.
    expect(cloudStore.loadMoreExpenses).not.toHaveBeenCalled();
  });

  test("does nothing without an active group", async () => {
    const { hook, cloudStore } = setup({ activeGroup: null });

    await act(async () => {
      await hook.result.current.handleExpenseDraftSubmit(draft());
    });

    expect(cloudStore.addExpense).not.toHaveBeenCalled();
  });

  describe("the expense detail stacks over whatever is already open", () => {
    // [MV]
    test("openExpenseDetail never touches the shared dialog slot", () => {
      const { hook, setDialog } = setup();

      act(() => hook.result.current.openExpenseDetail("expense_1"));

      expect(hook.result.current.selectedExpenseId).toBe("expense_1");
      expect(setDialog).not.toHaveBeenCalled();
    });

    // [MV]
    test("deleteExpense clears the selected id but leaves the dialog slot alone", async () => {
      const { hook, setDialog } = setup();

      act(() => hook.result.current.openExpenseDetail("expense_1"));
      await act(async () => {
        await hook.result.current.deleteExpense(expense());
      });

      expect(hook.result.current.selectedExpenseId).toBe("");
      expect(setDialog).not.toHaveBeenCalled();
    });

    test("closeExpenseDetail clears the selected id", () => {
      const { hook } = setup();

      act(() => hook.result.current.openExpenseDetail("expense_1"));
      act(() => hook.result.current.closeExpenseDetail());

      expect(hook.result.current.selectedExpenseId).toBe("");
    });
  });
});
