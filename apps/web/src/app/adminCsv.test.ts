import { describe, expect, test } from "vitest";
import type { AdminExpenseRow, AdminGroupRow, AdminUserRow } from "./apiClient";
import {
  adminCsvFileName,
  appendCsvTruncationNotice,
  buildAdminExpensesCsv,
  buildAdminGroupsCsv,
  buildAdminUsersCsv,
} from "./adminCsv";

function rows(csv: string): string[] {
  // Strip the BOM, then split on the CRLF endings Excel expects.
  return csv.replace(/^﻿/, "").trimEnd().split("\r\n");
}

const user: AdminUserRow = {
  id: "user_1",
  email: "alice@example.com",
  display_name: "Alice",
  avatar_url: null,
  created_at: "2026-07-01T02:00:00.000Z",
  last_seen_at: "2026-07-28T02:00:00.000Z",
  disabled_at: null,
  group_count: 2,
  expense_count: 9,
};

const group: AdminGroupRow = {
  id: "group_1",
  name: "東京旅行",
  currency: "TWD",
  created_at: "2026-07-01T02:00:00.000Z",
  archived_at: null,
  deleted_at: null,
  member_count: 3,
  expense_count: 12,
  spend_total_minor: 145_000,
  last_expense_at: "2026-07-20T02:00:00.000Z",
  owner_display_name: "Alice",
};

const expense: AdminExpenseRow = {
  id: "expense_1",
  title: "拉麵",
  kind: "expense",
  category: "food",
  amount_minor: 120_000,
  currency: "TWD",
  expense_date: "2026-07-04",
  note: null,
  image_url: null,
  receipt_image_url: null,
  created_at: "2026-07-04T02:00:00.000Z",
  deleted_at: null,
  version: 1,
  created_by_name: "Alice",
  transfer_to_name: null,
  payers: [{ member_id: "member_1", display_name: "Alice", amount_minor: 120_000, currency: "TWD" }],
  shares: [
    { member_id: "member_1", display_name: "Alice", share_type: "fixed", share_value: null, amount_minor: 60_000 },
    { member_id: "member_2", display_name: "Bob", share_type: "fixed", share_value: null, amount_minor: 60_000 },
  ],
};

describe("buildAdminUsersCsv", () => {
  test("writes a header and one row per user", () => {
    const lines = rows(buildAdminUsersCsv([user]));
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("使用者 ID,Email,名稱")).toBe(true);
    expect(lines[1]).toContain("alice@example.com");
    expect(lines[1]).toContain("正常");
  });

  test("says outright that a disabled account is disabled", () => {
    const lines = rows(buildAdminUsersCsv([{ ...user, disabled_at: "2026-07-20T00:00:00.000Z" }]));
    expect(lines[1]).toContain("已停用");
  });

  test("starts with a BOM and uses CRLF so Excel reads the Chinese correctly", () => {
    const csv = buildAdminUsersCsv([user]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
  });
});

describe("buildAdminGroupsCsv", () => {
  test("writes the amount as a plain decimal, not a formatted currency", () => {
    // 145000 minor units is 1450 - a spreadsheet has to be able to sum it.
    expect(rows(buildAdminGroupsCsv([group]))[1]).toContain(",1450,");
  });

  test("distinguishes archived from deleted", () => {
    expect(rows(buildAdminGroupsCsv([{ ...group, archived_at: "2026-07-21T00:00:00.000Z" }]))[1]).toContain("已封存");
    expect(rows(buildAdminGroupsCsv([{ ...group, deleted_at: "2026-07-21T00:00:00.000Z" }]))[1]).toContain("已刪除");
  });

  test("a name containing a comma is quoted rather than splitting the row", () => {
    const lines = rows(buildAdminGroupsCsv([{ ...group, name: '東京, 大阪' }]));
    expect(lines[1]).toContain('"東京, 大阪"');
    expect(lines).toHaveLength(2);
  });

  test("a name containing a quote has it doubled, per RFC 4180", () => {
    expect(rows(buildAdminGroupsCsv([{ ...group, name: '說"旅行"' }]))[1]).toContain('"說""旅行"""');
  });
});

describe("buildAdminExpensesCsv", () => {
  test("lists payers and share participants by name", () => {
    const line = rows(buildAdminExpensesCsv([expense]))[1];
    expect(line).toContain("Alice");
    expect(line).toContain("Alice、Bob");
  });

  test("a transfer shows its recipient instead of a share list", () => {
    const transfer: AdminExpenseRow = {
      ...expense,
      kind: "transfer",
      transfer_to_name: "Bob",
      shares: [],
    };
    const line = rows(buildAdminExpensesCsv([transfer]))[1];
    expect(line).toContain("Bob");
    // Category is meaningless for a transfer and is left blank, as in the
    // group-level export.
    expect(line).not.toContain("餐飲");
  });

  test("a soft-deleted expense is marked rather than silently included", () => {
    expect(rows(buildAdminExpensesCsv([{ ...expense, deleted_at: "2026-07-05T00:00:00.000Z" }]))[1]).toContain("已刪除");
  });

  test("an expense with no amount exports an empty cell, not NaN", () => {
    expect(rows(buildAdminExpensesCsv([{ ...expense, amount_minor: null }]))[1]).not.toContain("NaN");
  });
});

describe("adminCsvFileName", () => {
  test("names the file after what is inside it and when it was taken", () => {
    expect(adminCsvFileName("使用者", "2026-07-29")).toBe("equo-使用者-2026-07-29.csv");
  });
});

/**
 * A capped export used to be indistinguishable from a complete one: it opened,
 * it had a header, it had 5,000 rows, and the rest were missing with nothing
 * anywhere saying so. (fetchAllPages read `total` on every page and threw it
 * away, while its own comment claimed "the file says when it was truncated".)
 */
describe("appendCsvTruncationNotice", () => {
  const csv = buildAdminUsersCsv([user]);

  test("says how much is missing, in the file itself", () => {
    const noted = appendCsvTruncationNotice(csv, 5_000, 12_345);
    const last = rows(noted).at(-1) ?? "";

    expect(last).toContain("已截斷");
    expect(last).toContain("5,000");
    expect(last).toContain("12,345");
  });

  test("leaves a complete export completely alone", () => {
    expect(appendCsvTruncationNotice(csv, 1, 1)).toBe(csv);
    // Defensive: a total that somehow came back smaller is not a truncation.
    expect(appendCsvTruncationNotice(csv, 5, 3)).toBe(csv);
  });

  test("adds exactly one row, and does not disturb the ones above it", () => {
    const before = rows(csv);
    const after = rows(appendCsvTruncationNotice(csv, 1, 9));

    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  test("the note is one quoted field, so a comma in it cannot shift columns", () => {
    const last = rows(appendCsvTruncationNotice(csv, 5_000, 12_345)).at(-1) ?? "";
    expect(last.startsWith('"')).toBe(true);
    expect(last.endsWith('"')).toBe(true);
  });
});

describe("adminCsvFileName marks a capped export", () => {
  test("because the name is the part that survives being mailed to somebody", () => {
    expect(adminCsvFileName("使用者", "2026-09-08", true)).toBe("equo-使用者-2026-09-08-已截斷.csv");
  });

  test("and a complete export keeps the plain name", () => {
    expect(adminCsvFileName("使用者", "2026-09-08", false)).toBe("equo-使用者-2026-09-08.csv");
    expect(adminCsvFileName("使用者", "2026-09-08")).toBe("equo-使用者-2026-09-08.csv");
  });
});
