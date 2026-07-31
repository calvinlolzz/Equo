import { ADMIN_TAB_LABELS, type AdminRoute, type AdminTab } from "./adminRoute";
import type { AdminGroupRow, AdminUserRow } from "./apiClient";

/**
 * What the ⌘K palette can do, as data.
 *
 * The console has six lists, each with its own search box, so "find this
 * person" starts with remembering which tab they live on. This collapses that
 * into one box: type, pick, land on the right screen with the right URL - the
 * route work is what makes the last part possible.
 *
 * All of it is pure so the matching and ordering rules are testable without a
 * DOM: the component only renders what this returns and calls onNavigate with
 * the chosen patch.
 */

export type AdminCommandGroup = "tabs" | "users" | "groups";

export type AdminCommand = {
  id: string;
  group: AdminCommandGroup;
  label: string;
  /** Second line: an email, a currency, an id — whatever tells two rows apart. */
  hint?: string;
  /** Where picking it goes. Fed straight to the route patcher. */
  patch: Partial<AdminRoute>;
};

export const ADMIN_COMMAND_GROUP_LABELS: Record<AdminCommandGroup, string> = {
  tabs: "前往",
  users: "使用者",
  groups: "群組",
};

/** How many rows each remote group contributes; the palette is a shortcut, not a list view. */
export const ADMIN_COMMAND_RESULT_LIMIT = 5;

/** Below this the palette shows tabs only — one letter matches everything and searching is wasted. */
export const ADMIN_COMMAND_MIN_QUERY = 2;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export function shouldSearch(query: string): boolean {
  return query.trim().length >= ADMIN_COMMAND_MIN_QUERY;
}

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * Tab jumps. An empty query lists them all, which doubles as the palette's
 * "what can I do here" state on first open.
 */
export function tabCommands(query: string, options: { canManageAdmins: boolean }): AdminCommand[] {
  const tabs = (Object.keys(ADMIN_TAB_LABELS) as AdminTab[]).filter(
    (tab) => tab !== "admins" || options.canManageAdmins,
  );

  return tabs
    .filter((tab) => !query.trim() || matches(ADMIN_TAB_LABELS[tab], query))
    .map((tab) => ({
      id: `tab:${tab}`,
      group: "tabs" as const,
      label: ADMIN_TAB_LABELS[tab],
      patch: { tab },
    }));
}

/**
 * Everything the palette offers for one query, in the order it is shown.
 *
 * Tabs come last on a real query: someone who typed six characters of an email
 * wants the person, not the 使用者 tab that happens to contain the same
 * characters. With no query there is nothing else to show, so tabs are all
 * there is.
 *
 * A pasted uuid gets a direct jump in both drill-downs, because ids arrive
 * from logs and error reports where nothing says which kind they are.
 */
export function buildAdminCommands({
  query,
  users = [],
  groups = [],
  canManageAdmins,
}: {
  query: string;
  users?: AdminUserRow[];
  groups?: AdminGroupRow[];
  canManageAdmins: boolean;
}): AdminCommand[] {
  const trimmed = query.trim();
  const tabs = tabCommands(trimmed, { canManageAdmins });

  if (!trimmed) return tabs;

  const idJumps: AdminCommand[] = looksLikeId(trimmed)
    ? [
        {
          id: `id:group:${trimmed}`,
          group: "groups",
          label: "開啟這個群組 ID",
          hint: trimmed,
          patch: { tab: "groups", groupId: trimmed },
        },
        {
          id: `id:user:${trimmed}`,
          group: "users",
          label: "開啟這個使用者 ID",
          hint: trimmed,
          patch: { tab: "users", userId: trimmed },
        },
      ]
    : [];

  const userCommands: AdminCommand[] = users.slice(0, ADMIN_COMMAND_RESULT_LIMIT).map((user) => ({
    id: `user:${user.id}`,
    group: "users",
    label: user.display_name || user.email,
    hint: user.display_name ? user.email : undefined,
    patch: { tab: "users", userId: user.id },
  }));

  const groupCommands: AdminCommand[] = groups.slice(0, ADMIN_COMMAND_RESULT_LIMIT).map((group) => ({
    id: `group:${group.id}`,
    group: "groups",
    label: group.name,
    hint: `${group.member_count} 人・${group.currency}`,
    patch: { tab: "groups", groupId: group.id },
  }));

  return [...idJumps, ...userCommands, ...groupCommands, ...tabs];
}

/** Arrow-key movement that wraps, so holding Down never dead-ends. */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (((current + delta) % length) + length) % length;
}
