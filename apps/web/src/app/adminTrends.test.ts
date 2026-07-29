import { describe, expect, test } from "vitest";
import type { AdminHealthSummary, AdminTrendPoint } from "./apiClient";
import { healthTiles, trendChart } from "./adminDashboard";

function points(...values: number[]): AdminTrendPoint[] {
  return values.map((value, index) => ({
    day: `2026-07-${String(index + 1).padStart(2, "0")}`,
    new_users: value,
    active_users: value * 2,
    new_groups: 0,
    expenses: value * 3,
  }));
}

describe("trendChart", () => {
  test("reads the requested metric, not whichever field comes first", () => {
    const chart = trendChart(points(1, 2), "expenses");
    expect(chart.values).toEqual([3, 6]);
    expect(chart.total).toBe(9);
    expect(chart.max).toBe(6);
  });

  test("maps the series across the full width, oldest first", () => {
    const chart = trendChart(points(0, 5, 10), "new_users");
    // 3 points -> x at 0/50/100; y inverted so the peak sits at the top.
    expect(chart.polyline).toBe("0,100 50,50 100,0");
  });

  test("a single point is centred rather than pinned to the left edge", () => {
    expect(trendChart(points(4), "new_users").polyline).toBe("50,0");
  });

  test("an all-zero series draws a flat mid-line instead of dividing by zero", () => {
    const chart = trendChart(points(0, 0, 0), "new_users");
    expect(chart.max).toBe(0);
    expect(chart.polyline).toBe("0,50 50,50 100,50");
  });

  test("the y-scale is pinned to zero, so a small wobble stays a small wobble", () => {
    // 18 and 20 drawn min-to-max would look like a collapse; from 0 it is
    // two nearly-equal columns.
    const chart = trendChart(points(18, 20), "new_users");
    expect(chart.polyline).toBe("0,10 100,0");
  });

  test("change compares the recent half against the one before it", () => {
    // earlier 2 + 2 = 4, recent 4 + 4 = 8 -> +100%.
    expect(trendChart(points(2, 2, 4, 4), "new_users").changePct).toBe(100);
    expect(trendChart(points(4, 4, 2, 2), "new_users").changePct).toBe(-50);
  });

  test("no change is reported when the earlier half is empty", () => {
    // Growth "from zero" has no percentage, and 400% from a base of nothing
    // would be the most prominent number on the page.
    expect(trendChart(points(0, 0, 5, 5), "new_users").changePct).toBeNull();
    expect(trendChart([], "new_users").changePct).toBeNull();
  });

  test("an empty series produces an empty, drawable chart", () => {
    const chart = trendChart([], "expenses");
    expect(chart).toMatchObject({ values: [], labels: [], max: 0, total: 0, polyline: "" });
  });
});

describe("healthTiles", () => {
  const now = Date.parse("2026-07-29T10:00:00.000Z");

  function makeHealth(overrides: Partial<AdminHealthSummary> = {}): AdminHealthSummary {
    return {
      backup: { last_success_at: "2026-07-29T02:30:00.000Z", detail: { bytes: 1_048_576 } },
      rate_limit: { active_buckets: 0, blocked_24h: 0 },
      errors: { last_24h: 0, last_7d: 0, latest_at: null },
      feedback: { open: 0 },
      ...overrides,
    };
  }

  function tile(health: AdminHealthSummary, key: string) {
    return healthTiles(health, now).find((entry) => entry.key === key);
  }

  test("a fresh backup is green and shows its size", () => {
    const backup = tile(makeHealth(), "backup");
    expect(backup?.tone).toBe("ok");
    expect(backup?.hint).toBe("1 MB");
  });

  test("a backup older than a day and a half is flagged", () => {
    // The job runs nightly, so 36h+ means it did not just run late.
    const stale = makeHealth({ backup: { last_success_at: "2026-07-27T02:30:00.000Z", detail: {} } });
    expect(tile(stale, "backup")?.tone).toBe("warn");
  });

  test("never having recorded a backup is the worst state, not an unknown one", () => {
    const tileValue = tile(makeHealth({ backup: null }), "backup");
    expect(tileValue?.tone).toBe("bad");
    expect(tileValue?.value).toBe("從未");
  });

  test("errors escalate from quiet to noisy", () => {
    expect(tile(makeHealth(), "errors")?.tone).toBe("ok");
    expect(tile(makeHealth({ errors: { last_24h: 3, last_7d: 5, latest_at: null } }), "errors")?.tone).toBe("warn");
    expect(tile(makeHealth({ errors: { last_24h: 42, last_7d: 90, latest_at: null } }), "errors")?.tone).toBe("bad");
  });

  test("any rate-limited request is worth noticing", () => {
    expect(tile(makeHealth(), "rate_limit")?.tone).toBe("ok");
    const blocked = tile(makeHealth({ rate_limit: { active_buckets: 4, blocked_24h: 12 } }), "rate_limit");
    expect(blocked?.tone).toBe("warn");
    expect(blocked?.value).toBe("12");
  });

  test("unread feedback shows where to deal with it", () => {
    expect(tile(makeHealth({ feedback: { open: 2 } }), "feedback")?.tone).toBe("warn");
    expect(tile(makeHealth(), "feedback")?.hint).toBe("都看完了");
  });
});
