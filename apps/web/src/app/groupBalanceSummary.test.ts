import { describe, expect, test } from "vitest";
import type { Group } from "./appTypes";
import { balanceTone, describeBalance, summarizeGroupBalances } from "./groupBalanceSummary";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

function group(overrides: Partial<Group> = {}): Group {
  return { id: "group_1", name: "東京旅行", currency: "TWD", ...overrides };
}

describe("summarizeGroupBalances", () => {
  test("nets the groups that share a currency", () => {
    const summary = summarizeGroupBalances([
      group({ id: "group_1", balanceMinor: 50000 }),
      group({ id: "group_2", balanceMinor: -20000 }),
    ]);

    expect(summary).toEqual({ known: true, totals: [{ currency: "TWD", netMinor: 30000 }] });
  });

  test("never mixes currencies into one total", () => {
    const summary = summarizeGroupBalances([
      group({ id: "group_1", currency: "TWD", balanceMinor: -30000 }),
      group({ id: "group_2", currency: "JPY", balanceMinor: 500000 }),
    ]);

    // Adding these would produce a number that is not money in either
    // currency - the whole point of keeping them apart.
    expect(summary.totals).toEqual([
      { currency: "JPY", netMinor: 500000 },
      { currency: "TWD", netMinor: -30000 },
    ]);
  });

  test("drops a currency that nets out, and reports settled rather than unknown", () => {
    const summary = summarizeGroupBalances([
      group({ id: "group_1", balanceMinor: 12000 }),
      group({ id: "group_2", balanceMinor: -12000 }),
    ]);

    expect(summary).toEqual({ known: true, totals: [] });
  });

  test("groups without a balance are not counted as zero", () => {
    // The distinction the header depends on: "we don't know" must not render
    // as 已結清, so a list carrying no balances at all is not known.
    expect(summarizeGroupBalances([group(), group({ id: "group_2" })])).toEqual({ known: false, totals: [] });

    const partial = summarizeGroupBalances([group({ balanceMinor: -800 }), group({ id: "group_2" })]);
    expect(partial).toEqual({ known: true, totals: [{ currency: "TWD", netMinor: -800 }] });
  });

  // [MV]
  test("a personal ledger is skipped even when it carries a balance", () => {
    // A ledger always nets to zero (nobody else to owe), but the point here
    // is that it must not even be COUNTED - a user with only the ledger
    // should see nothing in the rail header, not 已結清.
    expect(
      summarizeGroupBalances([group({ id: "ledger", kind: "personal", balanceMinor: 0 })]),
    ).toEqual({ known: false, totals: [] });

    const mixed = summarizeGroupBalances([
      group({ id: "ledger", kind: "personal", balanceMinor: 0 }),
      group({ id: "group_2", balanceMinor: -800 }),
    ]);
    expect(mixed).toEqual({ known: true, totals: [{ currency: "TWD", netMinor: -800 }] });
  });
});

describe("describeBalance", () => {
  test("says which direction the money goes", () => {
    expect(describeBalance(30000, "TWD")).toBe(`${text.balanceOwedToYou} $300`);
    expect(describeBalance(-30000, "TWD")).toBe(`${text.balanceYouOwe} $300`);
    expect(describeBalance(0, "TWD")).toBe(text.balanceSettled);
  });

  test("shows the amount unsigned, since the words carry the sign", () => {
    expect(describeBalance(-125050, "TWD")).not.toContain("-");
  });

  test("renders nothing when the balance is unknown", () => {
    expect(describeBalance(undefined, "TWD")).toBeNull();
    expect(balanceTone(undefined)).toBeNull();
  });

  test("tone follows the sign", () => {
    expect(balanceTone(1)).toBe("positive");
    expect(balanceTone(-1)).toBe("negative");
    expect(balanceTone(0)).toBe("settled");
  });
});
