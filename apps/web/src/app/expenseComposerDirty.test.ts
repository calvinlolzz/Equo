import { describe, expect, test } from "vitest";
import { isComposerDirty, type ComposerSnapshot } from "./expenseComposerDirty";

function snapshot(overrides: Partial<ComposerSnapshot> = {}): ComposerSnapshot {
  return {
    mode: "expense",
    category: "general",
    dateTime: "2026-07-25T12:00",
    currency: "TWD",
    exchangeRate: "1",
    title: "",
    amount: "",
    payerId: "member_alice",
    transferToId: "member_bob",
    shareIds: ["member_alice", "member_bob"],
    splitMode: "equal",
    shareAmounts: {},
    sharePercents: {},
    payerRows: [],
    imageDataUrl: "",
    imageUrl: "",
    note: "",
    ...overrides,
  };
}

describe("isComposerDirty", () => {
  test("an untouched sheet is clean", () => {
    expect(isComposerDirty(snapshot(), snapshot())).toBe(false);
  });

  test.each([
    ["amount", { amount: "120" }],
    ["title", { title: "晚餐" }],
    ["note", { note: "記得收據" }],
    ["category", { category: "food" }],
    ["mode", { mode: "income" }],
    ["date", { dateTime: "2026-07-24T09:30" }],
    ["currency", { currency: "JPY" }],
    ["exchange rate", { exchangeRate: "0.21" }],
    ["payer", { payerId: "member_bob" }],
    ["transfer recipient", { transferToId: "member_carol" }],
    ["split mode", { splitMode: "custom" }],
    ["a picked photo", { imageDataUrl: "data:image/png;base64,AAA" }],
    ["a removed photo", { imageUrl: "" }],
  ] as const)("a changed %s is unsaved work", (_label, change) => {
    const initial = snapshot({ imageUrl: "https://cdn/receipt.png" });
    expect(isComposerDirty(initial, snapshot({ imageUrl: "https://cdn/receipt.png", ...change }))).toBe(true);
  });

  test("adding or removing a share member counts", () => {
    expect(isComposerDirty(snapshot(), snapshot({ shareIds: ["member_alice"] }))).toBe(true);
    expect(
      isComposerDirty(snapshot(), snapshot({ shareIds: ["member_alice", "member_bob", "member_carol"] })),
    ).toBe(true);
  });

  test("reordering share members counts — the split preview follows the order", () => {
    expect(isComposerDirty(snapshot(), snapshot({ shareIds: ["member_bob", "member_alice"] }))).toBe(true);
  });

  test("a typed then cleared per-member amount is back to clean", () => {
    // The input leaves its key behind holding "", which must read the same as
    // never having been touched.
    const cleared = snapshot({ shareAmounts: { member_alice: "" } });
    expect(isComposerDirty(snapshot(), cleared)).toBe(false);
    expect(isComposerDirty(snapshot(), snapshot({ shareAmounts: { member_alice: "60" } }))).toBe(true);
  });

  test("percent inputs compare the same way", () => {
    expect(isComposerDirty(snapshot(), snapshot({ sharePercents: { member_alice: "" } }))).toBe(false);
    expect(isComposerDirty(snapshot(), snapshot({ sharePercents: { member_alice: "50" } }))).toBe(true);
  });

  test("adding a second payer, or changing one's amount, counts", () => {
    const onePayer = snapshot({ payerRows: [{ payerId: "member_alice", amount: "100" }] });
    expect(
      isComposerDirty(
        onePayer,
        snapshot({
          payerRows: [
            { payerId: "member_alice", amount: "100" },
            { payerId: "member_bob", amount: "20" },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      isComposerDirty(onePayer, snapshot({ payerRows: [{ payerId: "member_alice", amount: "80" }] })),
    ).toBe(true);
  });

  test("an edit reopened and closed untouched is clean, one changed digit is not", () => {
    // The baseline is whatever the sheet opened with, not "empty" — otherwise
    // every edit would look dirty the moment it rendered.
    const existing = snapshot({ title: "晚餐", amount: "480", category: "food" });
    expect(isComposerDirty(existing, snapshot({ title: "晚餐", amount: "480", category: "food" }))).toBe(false);
    expect(isComposerDirty(existing, snapshot({ title: "晚餐", amount: "481", category: "food" }))).toBe(true);
  });
});
