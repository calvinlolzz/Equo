import { describe, expect, test } from "vitest";
import {
  buildAdminCommands,
  looksLikeId,
  moveSelection,
  shouldSearch,
  tabCommands,
} from "./adminCommands";
import type { AdminGroupRow, AdminUserRow } from "./apiClient";

function user(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "user_alice",
    email: "alice@example.com",
    display_name: "Alice",
    avatar_url: null,
    created_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: "2026-07-29T00:00:00.000Z",
    disabled_at: null,
    group_count: 1,
    expense_count: 3,
    ...overrides,
  };
}

function group(overrides: Partial<AdminGroupRow> = {}): AdminGroupRow {
  return {
    id: "group_1",
    name: "東京旅行",
    currency: "TWD",
    created_at: "2026-07-01T00:00:00.000Z",
    archived_at: null,
    deleted_at: null,
    member_count: 4,
    expense_count: 9,
    spend_total_minor: 120000,
    last_expense_at: null,
    owner_display_name: "Alice",
    ...overrides,
  };
}

const UUID = "11111111-1111-4111-8111-111111111111";

describe("tabCommands", () => {
  test("an empty query offers every tab, so the palette doubles as a menu", () => {
    const commands = tabCommands("", { canManageAdmins: true });

    expect(commands.map((command) => command.label)).toEqual([
      "總覽",
      "使用者",
      "群組",
      "回饋",
      "錯誤",
      "稽核",
      "管理員",
    ]);
  });

  test("hides the owner-only tab from everyone else", () => {
    expect(tabCommands("", { canManageAdmins: false }).some((c) => c.label === "管理員")).toBe(false);
  });

  test("filters by name", () => {
    expect(tabCommands("錯誤", { canManageAdmins: true }).map((c) => c.patch.tab)).toEqual(["errors"]);
  });
});

describe("buildAdminCommands", () => {
  test("puts people and groups above the tab jumps once there is a real query", () => {
    // "群組" matches both the tab of that name and the rows the server
    // returned, so the ordering rule is actually exercised.
    const commands = buildAdminCommands({
      query: "群組",
      users: [user()],
      groups: [group()],
      canManageAdmins: false,
    });

    // Someone who typed a name wants the row, not the tab that contains it.
    expect(commands[0]).toMatchObject({ group: "users", label: "Alice" });
    expect(commands[1]).toMatchObject({ group: "groups", label: "東京旅行" });
    expect(commands.at(-1)).toMatchObject({ group: "tabs", label: "群組" });
  });

  test("navigates straight to the drill-down, not just to the tab", () => {
    const [first] = buildAdminCommands({ query: "alice", users: [user()], canManageAdmins: false });

    expect(first.patch).toEqual({ tab: "users", userId: "user_alice" });
  });

  test("falls back to the email when a user has no display name", () => {
    const [first] = buildAdminCommands({
      query: "alice",
      users: [user({ display_name: "" })],
      canManageAdmins: false,
    });

    expect(first.label).toBe("alice@example.com");
    expect(first.hint).toBeUndefined();
  });

  test("a pasted id offers both drill-downs, because an id does not say what it is", () => {
    const commands = buildAdminCommands({ query: UUID, canManageAdmins: false });

    expect(commands.slice(0, 2).map((command) => command.patch)).toEqual([
      { tab: "groups", groupId: UUID },
      { tab: "users", userId: UUID },
    ]);
  });

  test("caps each remote group so the palette stays a shortcut", () => {
    const users = Array.from({ length: 12 }, (_, index) => user({ id: `user_${index}`, display_name: `U${index}` }));

    const commands = buildAdminCommands({ query: "u", users, canManageAdmins: false });

    expect(commands.filter((command) => command.group === "users")).toHaveLength(5);
  });

  test("keys are unique, so React never reuses a row for a different target", () => {
    const commands = buildAdminCommands({
      query: "a",
      users: [user(), user({ id: "user_bob", display_name: "Bob" })],
      groups: [group(), group({ id: "group_2", name: "大阪" })],
      canManageAdmins: true,
    });

    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
  });
});

describe("query gating", () => {
  test("one character does not go to the server", () => {
    expect(shouldSearch("")).toBe(false);
    expect(shouldSearch(" a ")).toBe(false);
    expect(shouldSearch("al")).toBe(true);
  });

  test("recognizes an id, and only an id", () => {
    expect(looksLikeId(UUID)).toBe(true);
    expect(looksLikeId(` ${UUID.toUpperCase()} `)).toBe(true);
    expect(looksLikeId("alice@example.com")).toBe(false);
    expect(looksLikeId("11111111-1111")).toBe(false);
  });
});

describe("moveSelection", () => {
  test("wraps at both ends so holding an arrow key never dead-ends", () => {
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(1, 1, 3)).toBe(2);
  });

  test("stays at zero when there is nothing to select", () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
