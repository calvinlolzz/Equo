import { describe, expect, test } from "vitest";
import { describeLastSeen, formatDate, overviewTiles, pageInfo } from "./adminDashboard";

const overview = {
  user_count: 5,
  active_users_7d: 3,
  new_users_7d: 1,
  group_count: 27,
  active_groups_7d: 4,
  expense_count: 32,
  expenses_7d: 6,
};

describe("overviewTiles", () => {
  test("maps the overview payload into four labelled tiles", () => {
    const tiles = overviewTiles(overview);

    expect(tiles.map((tile) => tile.key)).toEqual(["users", "new_users", "groups", "expenses"]);
    expect(tiles[0]).toMatchObject({ value: 5, hint: "近 7 日活躍 3" });
    expect(tiles[2]).toMatchObject({ value: 27, hint: "近 7 日有記帳 4" });
    expect(tiles[3]).toMatchObject({ value: 32, hint: "近 7 日新增 6" });
  });
});

describe("pageInfo", () => {
  test("first page of a multi-page list", () => {
    expect(pageInfo(45, 20, 0, 20)).toEqual({
      page: 1,
      pageCount: 3,
      hasPrev: false,
      hasNext: true,
      rangeStart: 1,
      rangeEnd: 20,
    });
  });

  test("last partial page", () => {
    expect(pageInfo(45, 20, 40, 5)).toEqual({
      page: 3,
      pageCount: 3,
      hasPrev: true,
      hasNext: false,
      rangeStart: 41,
      rangeEnd: 45,
    });
  });

  test("empty result set", () => {
    expect(pageInfo(0, 20, 0, 0)).toEqual({
      page: 1,
      pageCount: 1,
      hasPrev: false,
      hasNext: false,
      rangeStart: 0,
      rangeEnd: 0,
    });
  });
});

describe("describeLastSeen", () => {
  const now = Date.parse("2026-07-11T12:00:00.000Z");

  test("buckets recent activity into zh-TW relative labels", () => {
    expect(describeLastSeen("2026-07-11T11:59:30.000Z", now)).toBe("剛剛");
    expect(describeLastSeen("2026-07-11T11:15:00.000Z", now)).toBe("45 分鐘前");
    expect(describeLastSeen("2026-07-11T04:00:00.000Z", now)).toBe("8 小時前");
    expect(describeLastSeen("2026-07-08T12:00:00.000Z", now)).toBe("3 天前");
  });

  test("falls back to the absolute date beyond 30 days", () => {
    expect(describeLastSeen("2026-05-01T00:00:00.000Z", now)).toBe("2026/05/01");
  });

  test("renders an em dash for invalid timestamps", () => {
    expect(describeLastSeen("not-a-date", now)).toBe("—");
  });
});

describe("formatDate", () => {
  test("formats ISO timestamps as YYYY/MM/DD", () => {
    expect(formatDate("2026-07-01T08:30:00.000Z")).toMatch(/^2026\/0[67]\/\d{2}$/);
  });

  test("renders an em dash for null or invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("nope")).toBe("—");
  });
});
