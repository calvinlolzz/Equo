import { describe, expect, test } from "vitest";
import type { AdminHealthSummary, AdminTrendPoint } from "./apiClient";
import { healthTiles, inboxItems, trendChart } from "./adminDashboard";

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

  test("shows which model receipt recognition is running on", () => {
    const configured = tile(makeHealth({ receipt_scan: { configured: true, enabled: true, model: "claude-haiku-4-5" } }), "receipt_scan");
    expect(configured?.tone).toBe("ok");
    expect(configured?.value).toBe("已啟用");
    expect(configured?.hint).toBe("claude-haiku-4-5");
  });

  test("flags a missing API key, which otherwise fails silently", () => {
    // Without the key the app quietly degrades to attaching the photo, so
    // nobody reports it as broken - the console is the only signal there is.
    const off = tile(makeHealth({ receipt_scan: { configured: false, enabled: true, model: "claude-haiku-4-5" } }), "receipt_scan");
    expect(off?.tone).toBe("warn");
    expect(off?.value).toBe("未設定");
  });

  test("omits the tile entirely against an API that predates the field", () => {
    expect(tile(makeHealth(), "receipt_scan")).toBeUndefined();
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

describe("inboxItems", () => {
  const now = Date.parse("2026-07-30T09:00:00.000Z");

  function makeHealth(overrides: Partial<AdminHealthSummary> = {}): AdminHealthSummary {
    return {
      backup: { last_success_at: "2026-07-30T02:30:00.000Z", detail: {} },
      rate_limit: { active_buckets: 0, blocked_24h: 0 },
      errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
      feedback: { open: 0 },
      ...overrides,
    };
  }

  test("a healthy console has an empty list, which is the point", () => {
    expect(inboxItems(makeHealth(), now)).toEqual([]);
  });

  test("lists open feedback and unresolved errors with somewhere to go", () => {
    const items = inboxItems(
      makeHealth({
        feedback: { open: 2 },
        errors: { last_24h: 40, last_7d: 90, latest_at: null, open_groups: 3 },
      }),
      now,
    );

    expect(items).toEqual([
      { key: "feedback", label: "未處理回饋", count: 2, route: { tab: "feedback", status: "new" }, tone: "warn" },
      { key: "errors", label: "未處理錯誤", count: 3, route: { tab: "errors", status: "open" }, tone: "warn" },
    ]);
  });

  test("counts distinct errors, not occurrences", () => {
    // 400 reports of one already-resolved bug is not something to do today.
    const items = inboxItems(
      makeHealth({ errors: { last_24h: 400, last_7d: 400, latest_at: null, open_groups: 0 } }),
      now,
    );

    expect(items).toEqual([]);
  });

  test("a pile of distinct errors escalates past a warning", () => {
    const items = inboxItems(
      makeHealth({ errors: { last_24h: 9, last_7d: 9, latest_at: null, open_groups: 5 } }),
      now,
    );

    expect(items[0]?.tone).toBe("bad");
  });

  test("a stale backup is listed with no link, because it is not fixed in here", () => {
    const items = inboxItems(
      makeHealth({ backup: { last_success_at: "2026-07-27T02:30:00.000Z", detail: {} } }),
      now,
    );

    expect(items).toEqual([{ key: "backup", label: "備份已逾時", count: null, route: null, tone: "bad" }]);
  });

  test("never having backed up says so, rather than showing as merely late", () => {
    expect(inboxItems(makeHealth({ backup: null }), now)[0]?.label).toBe("從未成功備份");
  });

  test("a console still on the old health payload just omits the error row", () => {
    // open_groups is absent until its migration lands; that must not read as
    // "no errors are open" in a crash and must not throw either.
    const legacy = makeHealth({ errors: { last_24h: 4, last_7d: 9, latest_at: null } });

    expect(inboxItems(legacy, now)).toEqual([]);
  });
});
