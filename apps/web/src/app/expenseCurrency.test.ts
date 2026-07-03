import { describe, expect, test } from "vitest";
import { convertToGroupAmountMinor } from "./expenseCurrency";

describe("convertToGroupAmountMinor", () => {
  test("converts a source-currency amount into group-currency minor units", () => {
    expect(convertToGroupAmountMinor({ amount: "10", exchangeRate: "0.23" })).toBe(230);
    expect(convertToGroupAmountMinor({ amount: 100, exchangeRate: 1 })).toBe(10000);
  });

  test("rounds to the nearest minor unit", () => {
    expect(convertToGroupAmountMinor({ amount: "3", exchangeRate: "0.333" })).toBe(100);
  });

  test("falls back to 0 for invalid input", () => {
    expect(convertToGroupAmountMinor({ amount: "abc", exchangeRate: "1" })).toBe(0);
    expect(convertToGroupAmountMinor({ amount: "10", exchangeRate: "" })).toBe(0);
  });
});
