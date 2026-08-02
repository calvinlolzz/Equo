import { describe, expect, test } from "vitest";
import { createReceiptScanner, normaliseReceiptResult } from "./receiptScanner.js";

describe("normaliseReceiptResult", () => {
  const good = {
    recognised: true,
    merchant: "全家便利商店",
    total_amount: 125.5,
    currency: "TWD",
    purchased_at: "2026-07-29",
    category: "food",
    items: [{ name: "美式咖啡", amount: 65 }],
  };

  test("converts a decimal total to the hundredths every amount in the app uses", () => {
    expect(normaliseReceiptResult(good, "TWD")).toMatchObject({
      recognised: true,
      merchant: "全家便利商店",
      amount_minor: 12550,
      currency: "TWD",
      purchased_at: "2026-07-29",
      category: "food",
      items: [{ name: "美式咖啡", amount_minor: 6500 }],
    });
  });

  test("uses hundredths for JPY too, matching what a hand-typed yen expense stores", () => {
    // The composer round-trips every currency through /100, so a yen receipt
    // must not be scaled differently or 1200 JPY lands as 12 JPY.
    expect(normaliseReceiptResult({ ...good, total_amount: 1200, currency: "JPY" }, "TWD").amount_minor).toBe(120000);
  });

  test("reports nothing when the model said it did not recognise a receipt", () => {
    expect(normaliseReceiptResult({ ...good, recognised: false }, "TWD")).toEqual({
      recognised: false,
      merchant: null,
      amount_minor: null,
      currency: null,
      purchased_at: null,
      category: null,
      items: [],
    });
  });

  test("treats a claimed recognition with no readable total as a failed scan", () => {
    expect(normaliseReceiptResult({ ...good, total_amount: null }, "TWD").recognised).toBe(false);
    expect(normaliseReceiptResult({ ...good, total_amount: 0 }, "TWD").recognised).toBe(false);
    expect(normaliseReceiptResult({ ...good, total_amount: -50 }, "TWD").recognised).toBe(false);
  });

  test("drops a category that is not one of the composer's chips", () => {
    expect(normaliseReceiptResult({ ...good, category: "groceries" }, "TWD").category).toBeNull();
  });

  test("drops a date that is not a real calendar day", () => {
    expect(normaliseReceiptResult({ ...good, purchased_at: "2026-02-31" }, "TWD").purchased_at).toBeNull();
    expect(normaliseReceiptResult({ ...good, purchased_at: "29/07/2026" }, "TWD").purchased_at).toBeNull();
  });

  test("falls back to the group currency when the receipt printed none", () => {
    expect(normaliseReceiptResult({ ...good, currency: null }, "JPY").currency).toBe("JPY");
  });

  test("survives a response whose fields are the wrong types entirely", () => {
    const result = normaliseReceiptResult(
      { recognised: true, total_amount: "125.5", merchant: 42, items: "nope", category: [], purchased_at: {} },
      "TWD",
    );

    expect(result.recognised).toBe(false);
  });

  test("keeps only line items that have a name, and tolerates missing amounts", () => {
    const result = normaliseReceiptResult(
      { ...good, items: [{ name: "咖啡", amount: 65 }, { name: "   ", amount: 10 }, { amount: 20 }, null] },
      "TWD",
    );

    expect(result.items).toEqual([{ name: "咖啡", amount_minor: 6500 }]);
  });
});

describe("createReceiptScanner", () => {
  test("returns undefined without an API key so the route can report the feature off", () => {
    expect(createReceiptScanner(undefined)).toBeUndefined();
    expect(createReceiptScanner("")).toBeUndefined();
  });

  test("returns a scanner once a key is configured", () => {
    expect(typeof createReceiptScanner("sk-ant-test")).toBe("function");
  });
});
