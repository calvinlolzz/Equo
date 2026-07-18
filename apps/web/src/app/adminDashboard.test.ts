import { describe, expect, test } from "vitest";
import {
  adminRoleLabel,
  auditActionLabel,
  auditTargetText,
  describeLastSeen,
  expenseCategoryLabel,
  expenseImageUrl,
  expenseKindLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatExpenseAmount,
  inviteStatus,
  inviteStatusLabel,
  overviewTiles,
  storageTiles,
  pageInfo,
  payerSummary,
  shareTypeLabel,
} from "./adminDashboard";

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

describe("audit helpers", () => {
  test("translates known actions and passes unknown ones through", () => {
    expect(auditActionLabel("user.disable")).toBe("停用帳號");
    expect(auditActionLabel("group.restore")).toBe("復原群組");
    expect(auditActionLabel("future.action")).toBe("future.action");
  });

  test("prefers the group name, falls back to email, then em dash", () => {
    expect(auditTargetText({ name: "東京旅行", group_id: "g1" })).toBe("東京旅行");
    expect(auditTargetText({ email: "alice@example.com" })).toBe("alice@example.com");
    expect(auditTargetText({})).toBe("—");
  });

  test("formatDateTime renders date and minutes, dash on invalid", () => {
    expect(formatDateTime("2026-07-11T08:05:00.000Z")).toMatch(/^2026\/07\/11 \d{2}:\d{2}$/);
    expect(formatDateTime("bogus")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
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

describe("expense labels", () => {
  test("translates known kinds and share types, passing unknown ones through", () => {
    expect(expenseKindLabel("expense")).toBe("支出");
    expect(expenseKindLabel("transfer")).toBe("轉帳");
    expect(expenseKindLabel("future_kind")).toBe("future_kind");
    expect(shareTypeLabel("equal")).toBe("均分");
    expect(shareTypeLabel("percent")).toBe("百分比");
    expect(shareTypeLabel("future_type")).toBe("future_type");
  });

  test("reuses the app's category dictionary, passing unknown categories through", () => {
    expect(expenseCategoryLabel("food")).toBe("餐飲");
    expect(expenseCategoryLabel("lodging")).toBe("住宿");
    expect(expenseCategoryLabel("crypto")).toBe("crypto");
  });
});

describe("expenseImageUrl", () => {
  test("prefers image_url but falls back to the legacy receipt column", () => {
    expect(expenseImageUrl({ image_url: "https://cdn/a.jpg", receipt_image_url: "https://cdn/b.jpg" })).toBe(
      "https://cdn/a.jpg",
    );
    expect(expenseImageUrl({ image_url: null, receipt_image_url: "https://cdn/b.jpg" })).toBe("https://cdn/b.jpg");
  });

  test("returns null when neither column has a usable url", () => {
    expect(expenseImageUrl({ image_url: null, receipt_image_url: null })).toBeNull();
    expect(expenseImageUrl({ image_url: "", receipt_image_url: "" })).toBeNull();
  });
});

describe("payerSummary", () => {
  test("names a single payer but collapses multi-payer expenses to a count", () => {
    const payer = { member_id: "m1", display_name: "Alice", amount_minor: 1000, currency: "TWD" };

    expect(payerSummary([payer])).toBe("Alice");
    expect(payerSummary([payer, { ...payer, member_id: "m2", display_name: "Bob" }])).toBe("2 人分攤付款");
  });

  test("renders an em dash for no payers or a nameless one", () => {
    expect(payerSummary([])).toBe("—");
    expect(payerSummary([{ member_id: "m1", display_name: null, amount_minor: 1000, currency: "TWD" }])).toBe("—");
  });
});

describe("formatExpenseAmount", () => {
  test("formats a real amount but renders legacy null amounts as an em dash, not $0", () => {
    expect(formatExpenseAmount(12_000, "TWD")).toBe("$120");
    expect(formatExpenseAmount(0, "TWD")).toBe("$0");
    expect(formatExpenseAmount(null, "TWD")).toBe("—");
  });
});

describe("formatBytes", () => {
  test("scales to binary units and drops the decimal on whole values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(861938)).toBe("842 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1.4 * 1024 * 1024)).toBe("1.4 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  test("guards against negative or non-finite sizes", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("storageTiles", () => {
  test("with no orphans, the orphan tile is calm and reassuring", () => {
    const tiles = storageTiles({ object_count: 13, total_bytes: 861938, orphan_count: 0, orphan_bytes: 0 });
    const orphan = tiles.find((t) => t.key === "orphans");

    expect(tiles.map((t) => t.value)).toEqual(["13", "842 KB", "0"]);
    expect(orphan?.danger).toBe(false);
    expect(orphan?.hint).toBe("沒有未引用的圖片");
  });

  test("with orphans, the orphan tile flags danger and reports the wasted size", () => {
    const orphan = storageTiles({
      object_count: 20,
      total_bytes: 2_000_000,
      orphan_count: 3,
      orphan_bytes: 500_000,
    }).find((t) => t.key === "orphans");

    expect(orphan?.value).toBe("3");
    expect(orphan?.danger).toBe(true);
    expect(orphan?.hint).toBe("占用 488 KB");
  });
});

describe("inviteStatus", () => {
  const now = Date.parse("2026-07-18T00:00:00.000Z");
  const base = {
    id: "inv1",
    max_uses: 5,
    use_count: 0,
    expires_at: null,
    revoked_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    created_by_name: "Alice",
  };

  test("a fresh, unexpired, unused invite is live", () => {
    expect(inviteStatus(base, now)).toBe("live");
  });

  test("revoked wins over every other state", () => {
    expect(
      inviteStatus({ ...base, revoked_at: "2026-07-10T00:00:00.000Z", use_count: 99, expires_at: "2020-01-01T00:00:00.000Z" }, now),
    ).toBe("revoked");
  });

  test("expiry beats exhausted uses", () => {
    expect(inviteStatus({ ...base, expires_at: "2026-07-17T00:00:00.000Z", use_count: 99 }, now)).toBe("expired");
  });

  test("use_count reaching max_uses is used up", () => {
    expect(inviteStatus({ ...base, use_count: 5 }, now)).toBe("used_up");
    expect(inviteStatus({ ...base, use_count: 4 }, now)).toBe("live");
  });

  test("labels every status in zh-TW", () => {
    expect(inviteStatusLabel("live")).toBe("有效");
    expect(inviteStatusLabel("revoked")).toBe("已撤銷");
    expect(inviteStatusLabel("expired")).toBe("已過期");
    expect(inviteStatusLabel("used_up")).toBe("已用完");
  });
});

describe("adminRoleLabel", () => {
  test("labels known roles in zh-TW and passes unknown ones through", () => {
    expect(adminRoleLabel("owner")).toBe("擁有者");
    expect(adminRoleLabel("admin")).toBe("管理員");
    expect(adminRoleLabel("support")).toBe("客服");
    expect(adminRoleLabel("future_role")).toBe("future_role");
  });

  test("labels the new admin.* audit actions", () => {
    expect(auditActionLabel("admin.grant")).toBe("新增管理員");
    expect(auditActionLabel("admin.role_change")).toBe("變更管理員角色");
    expect(auditActionLabel("admin.remove")).toBe("移除管理員");
  });
});
