import { describe, expect, test } from "vitest";
import { formatAmount, formatAmountInputDisplay, formatSigned, stripAmountInput } from "./formatAmount";

describe("amount input formatting", () => {
  test("groups the integer part with commas", () => {
    expect(formatAmountInputDisplay("111111111")).toBe("111,111,111");
    expect(formatAmountInputDisplay("1234")).toBe("1,234");
    expect(formatAmountInputDisplay("999")).toBe("999");
  });

  test("preserves a trailing dot and decimals while typing", () => {
    expect(formatAmountInputDisplay("1234.")).toBe("1,234.");
    expect(formatAmountInputDisplay("1234.5")).toBe("1,234.5");
    expect(formatAmountInputDisplay("")).toBe("");
  });

  test("strips commas and non-numeric input, keeping one dot", () => {
    expect(stripAmountInput("1,234,567")).toBe("1234567");
    expect(stripAmountInput("12a3.4.5")).toBe("123.45");
    expect(stripAmountInput("$1,000")).toBe("1000");
  });
});

describe("formatAmount", () => {
  test("shows no cents for whole amounts, with thousands separators", () => {
    expect(formatAmount(100000, "TWD")).toBe("$1,000");
    expect(formatAmount(123400, "TWD")).toBe("$1,234");
  });

  test("shows two decimals for amounts with a fractional part", () => {
    expect(formatAmount(123456, "TWD")).toBe("$1,234.56");
  });

  test("keeps uneven-split shares honest instead of rounding a dollar away", () => {
    // $100 / 3 stores as 3334 / 3333 / 3333 minor. Rounding each to $33 made
    // the three shares read as $99 (review report issue ③); the real cents
    // must show. The $100 total itself stays clean.
    expect(formatAmount(3334, "TWD")).toBe("$33.34");
    expect(formatAmount(3333, "TWD")).toBe("$33.33");
    expect(formatAmount(10000, "TWD")).toBe("$100");
  });

  test("formats USD and EUR with their own symbols", () => {
    expect(formatAmount(100000, "USD")).toBe("$1,000");
    expect(formatAmount(100000, "EUR")).toBe("€1,000");
  });

  test("formats JPY and KRW with their own symbols", () => {
    expect(formatAmount(500000, "JPY")).toBe("¥5,000");
    expect(formatAmount(500000, "KRW")).toBe("₩5,000");
  });

  test("falls back to a '<CODE> ' prefix for an unmapped currency", () => {
    expect(formatAmount(100000, "GBP")).toBe("GBP 1,000");
  });

  test("formats zero", () => {
    expect(formatAmount(0, "TWD")).toBe("$0");
  });
});

describe("formatSigned", () => {
  test("prefixes a positive amount with +", () => {
    expect(formatSigned(100000, "TWD")).toBe("+$1,000");
  });

  test("prefixes a negative amount with - and formats the absolute value", () => {
    expect(formatSigned(-100000, "TWD")).toBe("-$1,000");
  });

  test("formats zero without a sign", () => {
    expect(formatSigned(0, "TWD")).toBe("$0");
  });

  test("honors the currency symbol for signed amounts", () => {
    expect(formatSigned(50000, "JPY")).toBe("+¥500");
    expect(formatSigned(-50000, "GBP")).toBe("-GBP 500");
  });
});

describe("a number that is not a number", () => {
  test("renders a dash, not 非數值", () => {
    // What the user actually saw: NaN.toLocaleString("zh-Hant") is "非數值", so
    // a partial payload put 「$非數值」 on the analysis screen.
    expect(formatAmount(Number.NaN, "TWD")).toBe("$—");
    expect(formatAmount(Number.POSITIVE_INFINITY, "TWD")).toBe("$—");
    expect(formatAmount(Number.NaN, "JPY")).toBe("¥—");
  });

  test("and never as zero, which would be a claim about the money", () => {
    // The dangerous branch is the signed one: NaN is neither > 0 nor < 0, so
    // without a guard it fell through to "settled up".
    expect(formatSigned(Number.NaN, "TWD")).toBe("$—");
    expect(formatSigned(Number.NaN, "TWD")).not.toBe(formatSigned(0, "TWD"));
  });

  test("real amounts are untouched", () => {
    expect(formatAmount(0, "TWD")).toBe("$0");
    expect(formatSigned(0, "TWD")).toBe("$0");
    expect(formatSigned(-250, "TWD")).toBe("-$2.50");
  });
});
