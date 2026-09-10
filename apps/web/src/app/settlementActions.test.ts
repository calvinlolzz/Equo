import { describe, expect, test } from "vitest";
import { parseSettleAmountMinor, settleAmountInputValue, settlementBetween } from "./settlementActions";

/**
 * The arithmetic behind two things 清償 could not do: pay part of a debt, and
 * pay it to somebody the minimal-transfer suggestions never named.
 */

describe("the amount typed into the settle confirm", () => {
  test("an ordinary number", () => {
    expect(parseSettleAmountMinor("1000", 500_000)).toEqual({ minor: 100_000, valid: true });
  });

  test("cents survive", () => {
    expect(parseSettleAmountMinor("43.55", 4_355)).toEqual({ minor: 4_355, valid: true });
  });

  test("the whole balance is allowed — that is the default, not an edge case", () => {
    expect(parseSettleAmountMinor("43.55", 4_355).valid).toBe(true);
  });

  test("a comma from the formatted display is not a syntax error", () => {
    expect(parseSettleAmountMinor("1,250", 500_000)).toEqual({ minor: 125_000, valid: true });
  });

  test("full-width digits, which is what a phone keyboard can hand over", () => {
    expect(parseSettleAmountMinor("１２３", 500_000)).toEqual({ minor: 12_300, valid: true });
  });

  test("empty is not ready rather than wrong", () => {
    // Mid-typing. The button is off; nothing is shouted about.
    expect(parseSettleAmountMinor("", 4_355)).toEqual({ minor: 0, valid: false });
  });

  test("zero settles nothing", () => {
    expect(parseSettleAmountMinor("0", 4_355).valid).toBe(false);
  });

  test("letters are refused, not coerced", () => {
    expect(parseSettleAmountMinor("abc", 4_355).valid).toBe(false);
    expect(parseSettleAmountMinor("1e5", 4_355).valid).toBe(false);
    expect(parseSettleAmountMinor("-100", 4_355).valid).toBe(false);
  });

  test("more than the balance is refused rather than quietly trimmed", () => {
    // Clamping would record something other than what was asked for. Money
    // going the other way is a 轉帳, not a settlement.
    const over = parseSettleAmountMinor("100", 4_355);
    expect(over.valid).toBe(false);
    // The parsed value survives, so the dialog can tell "too much" apart from
    // "not a number yet" and say which.
    expect(over.minor).toBe(10_000);
  });

  test("what goes into the field when it opens", () => {
    expect(settleAmountInputValue(4_355)).toBe("43.55");
    expect(settleAmountInputValue(100_000)).toBe("1000");
    expect(settleAmountInputValue(0)).toBe("0");
  });

  test("and it round-trips", () => {
    for (const minor of [4_355, 100_000, 1, 999_99]) {
      expect(parseSettleAmountMinor(settleAmountInputValue(minor), minor)).toEqual({ minor, valid: true });
    }
  });
});

describe("settling straight with one person", () => {
  const me = (balanceMinor: number) => ({ id: "me", balanceMinor });
  const them = (balanceMinor: number) => ({ id: "bob", balanceMinor });

  test("I owe, they are owed: I pay them", () => {
    expect(settlementBetween(me(-5_000), them(3_000))).toEqual({
      fromMemberId: "me",
      toMemberId: "bob",
      amountMinor: 3_000,
    });
  });

  test("they owe, I am owed: they pay me", () => {
    expect(settlementBetween(me(3_000), them(-5_000))).toEqual({
      fromMemberId: "bob",
      toMemberId: "me",
      amountMinor: 3_000,
    });
  });

  test("the amount is the smaller of the two, so nobody overshoots", () => {
    // I owe 500, they are owed 3,000: paying them 500 clears me and leaves
    // them owed 2,500 by somebody else.
    expect(settlementBetween(me(-500), them(3_000))?.amountMinor).toBe(500);
    // I owe 5,000, they are owed 300: paying 300 clears them.
    expect(settlementBetween(me(-5_000), them(300))?.amountMinor).toBe(300);
  });

  test("both owing the group means nothing passes between us", () => {
    expect(settlementBetween(me(-5_000), them(-3_000))).toBeNull();
  });

  test("both owed, likewise", () => {
    expect(settlementBetween(me(5_000), them(3_000))).toBeNull();
  });

  test("either side square is nothing to record", () => {
    expect(settlementBetween(me(0), them(3_000))).toBeNull();
    expect(settlementBetween(me(-5_000), them(0))).toBeNull();
    expect(settlementBetween(me(0), them(0))).toBeNull();
  });

  test("not with yourself", () => {
    expect(settlementBetween({ id: "me", balanceMinor: -5_000 }, { id: "me", balanceMinor: 5_000 })).toBeNull();
  });

  test("it is symmetric — the answer does not depend on the argument order", () => {
    const forwards = settlementBetween(me(-5_000), them(3_000));
    const backwards = settlementBetween(them(3_000), me(-5_000));
    expect(forwards).toEqual(backwards);
  });
});
