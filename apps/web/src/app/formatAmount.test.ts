import { describe, expect, test } from "vitest";
import { formatAmount, formatSigned } from "./formatAmount";

describe("formatAmount", () => {
  test("formats TWD with a $ prefix, whole-unit rounding, and thousands separators", () => {
    expect(formatAmount(123456, "TWD")).toBe("$1,235");
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

  test("rounds to the nearest whole unit", () => {
    expect(formatAmount(149, "TWD")).toBe("$1");
    expect(formatAmount(150, "TWD")).toBe("$2");
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
