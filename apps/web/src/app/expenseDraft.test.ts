import { describe, expect, test } from "vitest";
import { canSubmitExpenseDraft, canSubmitTransferDraft } from "./expenseDraft";

describe("canSubmitExpenseDraft", () => {
  test("requires a positive amount and at least one share member", () => {
    expect(canSubmitExpenseDraft({ amount: "500", selectedShareMemberCount: 2 })).toBe(true);
    expect(canSubmitExpenseDraft({ amount: "0", selectedShareMemberCount: 2 })).toBe(false);
    expect(canSubmitExpenseDraft({ amount: "500", selectedShareMemberCount: 0 })).toBe(false);
  });

  test("in custom split mode, also requires the shares to sum to the total", () => {
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        isCustomSplit: true,
        totalAmountMinor: 50000,
        shareAmountsMinor: { a: 30000, b: 20000 },
      }),
    ).toBe(true);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        isCustomSplit: true,
        totalAmountMinor: 50000,
        shareAmountsMinor: { a: 30000, b: 10000 },
      }),
    ).toBe(false);
  });

  test("splitMode amount behaves like the legacy isCustomSplit flag", () => {
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        splitMode: "amount",
        totalAmountMinor: 50000,
        shareAmountsMinor: { a: 30000, b: 20000 },
      }),
    ).toBe(true);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        splitMode: "amount",
        totalAmountMinor: 50000,
        shareAmountsMinor: { a: 30000, b: 10000 },
      }),
    ).toBe(false);
  });

  test("percent split mode requires percents summing to 100 with every member above zero", () => {
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        splitMode: "percent",
        shareMemberIds: ["a", "b"],
        sharePercents: { a: 70, b: 30 },
      }),
    ).toBe(true);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        splitMode: "percent",
        shareMemberIds: ["a", "b"],
        sharePercents: { a: 70, b: 25 },
      }),
    ).toBe(false);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        splitMode: "percent",
        shareMemberIds: ["a", "b"],
        sharePercents: { a: 100, b: 0 },
      }),
    ).toBe(false);
  });

  test("multi-payer rows gate submission until payments sum to the total", () => {
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        totalAmountMinor: 50000,
        paymentAmountsMinor: { row1: 30000, row2: 20000 },
      }),
    ).toBe(true);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        totalAmountMinor: 50000,
        paymentAmountsMinor: { row1: 30000, row2: 10000 },
      }),
    ).toBe(false);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        totalAmountMinor: 50000,
        paymentAmountsMinor: { row1: 50000, row2: 0 },
      }),
    ).toBe(false);
  });
});

describe("canSubmitTransferDraft", () => {
  test("requires a positive amount and two different members", () => {
    expect(canSubmitTransferDraft({ amount: "100", fromMemberId: "a", toMemberId: "b" })).toBe(true);
    expect(canSubmitTransferDraft({ amount: "0", fromMemberId: "a", toMemberId: "b" })).toBe(false);
    expect(canSubmitTransferDraft({ amount: "100", fromMemberId: "a", toMemberId: "a" })).toBe(false);
    expect(canSubmitTransferDraft({ amount: "100", fromMemberId: "", toMemberId: "b" })).toBe(false);
    expect(canSubmitTransferDraft({ amount: "100", fromMemberId: "a", toMemberId: "" })).toBe(false);
  });
});
