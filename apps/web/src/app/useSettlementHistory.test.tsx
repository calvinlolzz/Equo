// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Expense } from "./appTypes";
import type { SettlementRecord } from "./settlementHistory";
import { useSettlementHistory } from "./useSettlementHistory";

function settlementExpense(id: string, createdAt: string): Expense {
  return {
    id,
    title: "清償轉帳",
    amountMinor: 50_000,
    currency: "TWD",
    createdAt,
    payerId: "member_a",
    shareMemberIds: ["member_b"],
    transferToMemberId: "member_b",
    kind: "settlement",
  } as Expense;
}

function localRecord(id: string, createdAt: string): SettlementRecord {
  return { id, fromMemberId: "member_a", toMemberId: "member_b", amountMinor: 50_000, currency: "TWD", createdAt };
}

function Probe(props: Parameters<typeof useSettlementHistory>[0]) {
  const history = useSettlementHistory(props);
  return (
    <div>
      <span data-testid="ids">{history.records.map((entry) => entry.id).join(",")}</span>
      <span data-testid="count">{history.matchCount}</span>
      <span data-testid="degraded">{String(history.degraded)}</span>
    </div>
  );
}

afterEach(cleanup);

describe("useSettlementHistory", () => {
  test("reaches past the loaded window", async () => {
    const searchExpenses = vi.fn(async () => ({
      expenses: [settlementExpense("march", "2026-03-01T00:00:00.000Z")],
      matchCount: 1,
    }));

    await act(async () => {
      render(<Probe searchExpenses={searchExpenses} enabled localRecords={[]} />);
    });

    expect(screen.getByTestId("ids").textContent).toBe("march");
    // The app's word, translated to the column's at the store boundary.
    expect(searchExpenses).toHaveBeenCalledWith(expect.objectContaining({ kind: "settlement" }));
  });

  test("an optimistic 清償 shows alongside the fetched history", async () => {
    const searchExpenses = vi.fn(async () => ({
      expenses: [settlementExpense("old", "2026-03-01T00:00:00.000Z")],
      matchCount: 1,
    }));

    await act(async () => {
      render(
        <Probe
          searchExpenses={searchExpenses}
          enabled
          localRecords={[localRecord("just-now", "2026-08-24T00:00:00.000Z")]}
        />,
      );
    });

    expect(screen.getByTestId("ids").textContent).toBe("just-now,old");
  });

  test("does not fetch while the panel is closed", () => {
    const searchExpenses = vi.fn(async () => ({ expenses: [], matchCount: 0 }));

    render(<Probe searchExpenses={searchExpenses} enabled={false} localRecords={[]} />);

    expect(searchExpenses).not.toHaveBeenCalled();
  });

  test("a failed fetch degrades to the local window rather than emptying the section", async () => {
    // Offline is not a reason to tell somebody their settlement history is
    // gone. The old behaviour is the floor.
    const searchExpenses = vi.fn(async () => {
      throw new Error("offline");
    });

    await act(async () => {
      render(
        <Probe
          searchExpenses={searchExpenses}
          enabled
          localRecords={[localRecord("local", "2026-08-01T00:00:00.000Z")]}
        />,
      );
    });

    expect(screen.getByTestId("ids").textContent).toBe("local");
    expect(screen.getByTestId("degraded").textContent).toBe("true");
  });

  test("the total never reports fewer than the rows on screen", async () => {
    // A locally-optimistic row the server has not seen yet would otherwise
    // produce "共 1 筆" above a list of two.
    const searchExpenses = vi.fn(async () => ({
      expenses: [settlementExpense("old", "2026-03-01T00:00:00.000Z")],
      matchCount: 1,
    }));

    await act(async () => {
      render(
        <Probe
          searchExpenses={searchExpenses}
          enabled
          localRecords={[localRecord("just-now", "2026-08-24T00:00:00.000Z")]}
        />,
      );
    });

    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  test("reports the server's total when it exceeds the page it returned", async () => {
    const searchExpenses = vi.fn(async () => ({
      expenses: [settlementExpense("one", "2026-03-01T00:00:00.000Z")],
      matchCount: 137,
    }));

    await act(async () => {
      render(<Probe searchExpenses={searchExpenses} enabled localRecords={[]} />);
    });

    expect(screen.getByTestId("count").textContent).toBe("137");
  });
});
