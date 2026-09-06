// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Expense } from "./appTypes";
import { RecordsPanel } from "./RecordsPanel";
import { UI_TEXT } from "./uiText";

/**
 * The records list mounts a bounded window of rows and grows it as the user
 * scrolls (see RENDER_WINDOW_STEP). These tests drive that window directly:
 * jsdom has no IntersectionObserver, so one is installed here and its callback
 * fired by hand - the panel's own fallback (mount everything when the API is
 * missing) would otherwise hide the behaviour under test entirely.
 */

type FakeObserver = {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: boolean;
};

// Each row now carries a swipe hook and its own non-passive touchmove
// listener, so mounting 200 of them costs more than it did when a row was a
// bare button — enough to tip this file past vitest's 5s default under a loaded
// suite. Same treatment as the other integration files; the app itself only
// ever mounts RENDER_WINDOW_STEP (40) rows at a time.
vi.setConfig({ testTimeout: 15_000 });

let observers: FakeObserver[] = [];

/** Fire the newest live observer as if its sentinel had scrolled into range. */
function scrollSentinelIntoView() {
  const observer = observers.filter((candidate) => !candidate.disconnected).at(-1);
  if (!observer) throw new Error("no live IntersectionObserver - the sentinel is not mounted");
  // act() so the resulting setState and the effect that re-arms the observer
  // both flush before the assertion reads the row count.
  act(() => {
    observer.callback(
      observer.observed.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private entry: FakeObserver;
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, observed: [], disconnected: false };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.observed.push(target);
      }
      disconnect() {
        this.entry.disconnected = true;
      }
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** `count` expenses, one per day, newest first - so every day group is 1 row. */
function dailyExpenses(count: number): Expense[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    title: `品項 ${i}`,
    amountMinor: 10000,
    currency: "TWD",
    // 2026-07-01 counting backwards a day at a time.
    createdAt: new Date(Date.UTC(2026, 6, 1) - i * 86_400_000).toISOString(),
    payerId: "m1",
    shareMemberIds: ["m1"],
  }));
}

function renderPanel(expenses: Expense[], overrides: Partial<Parameters<typeof RecordsPanel>[0]> = {}) {
  const onLoadMore = vi.fn();
  render(
    <RecordsPanel
      expenseCount={expenses.length}
      totalExpenseMinor={expenses.length * 10000}
      currency="TWD"
      expenses={expenses}
      members={[{ id: "m1", name: "我" }]}
      activities={[]}
      canLoadMoreExpenses={false}
      loadingMoreExpenses={false}
      pendingAction={null}
      pendingWriteIds={new Set()}
      onLoadMore={onLoadMore}
      onOpenExpense={vi.fn()}
      // These render-window tests never turn a filter on, so the search path
      // stays dormant; the cases that exercise it pass their own searcher.
      searchExpenses={null}
      describeError={(error) => String(error)}
      onEditExpense={vi.fn()}
      onDeleteExpense={vi.fn()}
      {...overrides}
    />,
  );
  return { onLoadMore };
}

function mountedRowCount() {
  return screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row")).length;
}

describe("records list render window", () => {
  test("mounts a bounded slice of a long list instead of every loaded row", () => {
    renderPanel(dailyExpenses(200));

    // Not 200. The exact cap is an implementation detail; that it is bounded
    // well below the loaded count is the point.
    expect(mountedRowCount()).toBe(40);
  });

  test("scrolling the sentinel into range mounts the next slice", () => {
    renderPanel(dailyExpenses(200));
    expect(mountedRowCount()).toBe(40);

    scrollSentinelIntoView();
    expect(mountedRowCount()).toBe(80);

    scrollSentinelIntoView();
    expect(mountedRowCount()).toBe(120);
  });

  test("keeps growing until the whole loaded list is mounted, then stops observing", () => {
    renderPanel(dailyExpenses(90));

    scrollSentinelIntoView();
    scrollSentinelIntoView();
    expect(mountedRowCount()).toBe(90);
    // Everything is on screen, so the sentinel is gone and nothing is left live.
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  });

  test("a short list mounts in full with no sentinel at all", () => {
    renderPanel(dailyExpenses(5));

    expect(mountedRowCount()).toBe(5);
    expect(observers).toHaveLength(0);
  });

  test("changing the filter restarts the window rather than carrying the old depth", () => {
    renderPanel(dailyExpenses(200));
    scrollSentinelIntoView();
    expect(mountedRowCount()).toBe(80);

    // A filter every row matches, so the reset is visible as a row count and
    // not confounded by rows dropping out.
    fireEvent.change(screen.getByLabelText("搜尋支出"), { target: { value: "品項" } });

    expect(mountedRowCount()).toBe(40);
  });

  test("holds back the server's 載入更多 until the local rows are all mounted", () => {
    renderPanel(dailyExpenses(90), { canLoadMoreExpenses: true });

    expect(screen.queryByText(UI_TEXT.app.loadMoreRecords)).toBeNull();

    scrollSentinelIntoView();
    scrollSentinelIntoView();

    expect(mountedRowCount()).toBe(90);
    expect(screen.getByText(UI_TEXT.app.loadMoreRecords)).toBeTruthy();
  });

  test("day subtotals cover the whole day even when the window cuts off mid-list", () => {
    // 60 expenses on one day, then 60 on the day before: the window (40) ends
    // inside the first day, which must still print all 60 rows' subtotal.
    const sameDay = (day: number, count: number, offset: number): Expense[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `d${day}-${i}`,
        title: `品項 ${offset + i}`,
        amountMinor: 10000,
        currency: "TWD",
        createdAt: `2026-07-${String(day).padStart(2, "0")}T1${i % 10}:00:00+08:00`,
        payerId: "m1",
        shareMemberIds: ["m1"],
      }));
    renderPanel([...sameDay(13, 60, 0), ...sameDay(12, 60, 60)]);

    // The day is taken whole rather than truncated to the 40-row budget...
    expect(mountedRowCount()).toBe(60);
    // ...so its header subtotal is the real 60 x $100 day total, and the
    // second day has not been mounted.
    expect(screen.getByText("$6,000")).toBeTruthy();
  });
});

describe("swipe-row actions", () => {
  function swipeLeft(row: HTMLElement) {
    act(() => {
      fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 0 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 180, clientY: 0 }] });
      fireEvent.touchEnd(row, { touches: [] });
    });
  }

  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("620px"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });

  test("swiping a row reaches the same edit handler the detail dialog uses", () => {
    const onEditExpense = vi.fn();
    renderPanel(dailyExpenses(3), { onEditExpense });

    const row = screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row"))[0];
    swipeLeft(row);

    fireEvent.click(screen.getAllByText(UI_TEXT.app.editExpenseAction)[0]);

    expect(onEditExpense).toHaveBeenCalledTimes(1);
    expect(onEditExpense.mock.calls[0][0].id).toBe("e0");
  });

  test("swiping reaches delete too", () => {
    const onDeleteExpense = vi.fn();
    renderPanel(dailyExpenses(3), { onDeleteExpense });

    const row = screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row"))[0];
    swipeLeft(row);

    fireEvent.click(screen.getAllByText(UI_TEXT.app.deleteExpense)[0]);

    expect(onDeleteExpense).toHaveBeenCalledTimes(1);
    expect(onDeleteExpense.mock.calls[0][0].id).toBe("e0");
  });

  test("the tap that closes an open row does not also open the detail dialog", () => {
    const onOpenExpense = vi.fn();
    renderPanel(dailyExpenses(3), { onOpenExpense });

    const row = screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row"))[0];
    swipeLeft(row);
    fireEvent.click(row);

    expect(onOpenExpense).not.toHaveBeenCalled();
    // ...and the row is closed, so the next tap behaves normally again.
    fireEvent.click(row);
    expect(onOpenExpense).toHaveBeenCalledTimes(1);
  });

  test("only one row is ever open", () => {
    renderPanel(dailyExpenses(3));
    const rows = screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row"));

    swipeLeft(rows[0]);
    expect(rows[0].style.transform).toBe("translateX(-144px)");

    swipeLeft(rows[1]);
    expect(rows[1].style.transform).toBe("translateX(-144px)");
    expect(rows[0].style.transform).toBe("");
  });
});
