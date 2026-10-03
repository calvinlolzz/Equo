import type { PostgrestClient } from "../db/postgrestClient.js";
import { columns, eq, limit, query } from "../db/postgrestClient.js";
import { sha256Hex } from "./lineCrypto.js";

/**
 * Typed wrappers around the line_* RPCs from
 * supabase/migrations/20260929090000_line_bot.sql (and, for the budget
 * commands, 20260930090000_line_set_budget.sql, and, for the 「本月」
 * category breakdown, 20261003090000_line_month_categories.sql). One
 * function per RPC, named to match, so a call site reads like the SQL it
 * triggers.
 */

export type LineLedger = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  cover_image_url: string | null;
  monthly_budget_minor: number | null;
  kind: string;
};

export type LineContext = {
  user_id: string;
  email: string;
  locale: string;
  disabled: boolean;
  ledger: LineLedger | null;
  categories: Array<{ key: string; label: string; color: string; scope: string }>;
};

export async function getLineContext(client: PostgrestClient, lineUserId: string): Promise<LineContext | null> {
  return client.rpc<LineContext | null>("line_context", { p_line_user_id: lineUserId });
}

export async function registerLinkToken(
  client: PostgrestClient,
  linkTokenHash: string,
  lineUserId: string,
  ttlSeconds = 600,
): Promise<{ ok: boolean }> {
  return client.rpc<{ ok: boolean }>("line_register_link_token", {
    p_link_token_hash: linkTokenHash,
    p_line_user_id: lineUserId,
    p_ttl_seconds: ttlSeconds,
  });
}

export type AttachLinkRequestResult =
  | { ok: false; reason: "unknown" | "used" | "expired" | "claimed" }
  | { ok: true; already_linked: boolean; currently_linked?: boolean };

export async function attachLinkRequest(
  client: PostgrestClient,
  linkTokenHash: string,
  userId: string,
  nonceHash: string,
  locale: string,
): Promise<AttachLinkRequestResult> {
  return client.rpc<AttachLinkRequestResult>("line_attach_link_request", {
    p_link_token_hash: linkTokenHash,
    p_user: userId,
    p_nonce_hash: nonceHash,
    p_locale: locale,
  });
}

export type ConsumeLinkNonceResult =
  | { ok: false; reason: "unknown" | "user_mismatch" | "used" | "expired" | "account_disabled" }
  | { ok: true; replay: boolean; email: string; locale: string; replaced?: boolean };

export async function consumeLinkNonce(
  client: PostgrestClient,
  nonceHash: string,
  lineUserId: string,
): Promise<ConsumeLinkNonceResult> {
  return client.rpc<ConsumeLinkNonceResult>("line_consume_link_nonce", {
    p_nonce_hash: nonceHash,
    p_line_user_id: lineUserId,
  });
}

/** "解除綁定" from chat. */
export async function unlinkLineUser(client: PostgrestClient, lineUserId: string): Promise<{ ok: boolean; unlinked: boolean }> {
  return client.rpc<{ ok: boolean; unlinked: boolean }>("line_unlink", { p_line_user_id: lineUserId });
}

/** DELETE /api/v1/me/line from the profile page - scoped to the caller's own Equo user id. */
export async function unlinkLineForUser(client: PostgrestClient, userId: string): Promise<{ ok: boolean; unlinked: boolean }> {
  return client.rpc<{ ok: boolean; unlinked: boolean }>("line_unlink_user", { p_user: userId });
}

export type LineMonthTotals = { expense_minor: number; income_minor: number };

/** One row of line_month_summary's per-category breakdown: a category key and its expense total (minor units) for the month. */
export type LineMonthCategoryTotal = { category: string; expense_minor: number };

export type RecordLineEntryResult =
  | { ok: false; reason: "not_linked" | "account_disabled" | "no_ledger" }
  | {
      ok: true;
      replay: boolean;
      expense: Record<string, unknown>;
      ledger_id: string;
      currency: string;
      budget_minor: number | null;
      month: LineMonthTotals;
    };

export async function recordLineEntry(
  client: PostgrestClient,
  args: {
    lineUserId: string;
    eventId: string;
    title: string;
    kind: "expense" | "income";
    category: string;
    amountMinor: number;
    expenseDate: string;
    monthStart: string;
  },
): Promise<RecordLineEntryResult> {
  return client.rpc<RecordLineEntryResult>("line_record_entry", {
    p_line_user_id: args.lineUserId,
    p_event_id: args.eventId,
    p_title: args.title,
    p_kind: args.kind,
    p_category: args.category,
    p_amount_minor: args.amountMinor,
    p_expense_date: args.expenseDate,
    p_month_start: args.monthStart,
  });
}

export type UndoLastLineEntryResult =
  | { ok: false; reason: "not_linked" | "nothing_to_undo" | "already_gone"; replay?: boolean }
  | { ok: true; replay: boolean; expense: Record<string, unknown> };

export async function undoLastLineEntry(
  client: PostgrestClient,
  lineUserId: string,
  eventId: string,
  windowMinutes = 30,
): Promise<UndoLastLineEntryResult> {
  return client.rpc<UndoLastLineEntryResult>("line_undo_last", {
    p_line_user_id: lineUserId,
    p_event_id: eventId,
    p_window_minutes: windowMinutes,
  });
}

export type LineMonthSummaryResult =
  | { ok: false; reason: "not_linked" | "account_disabled" | "no_ledger" }
  | {
      ok: true;
      ledger_id: string;
      currency: string;
      budget_minor: number | null;
      month: LineMonthTotals;
      /**
       * Top expense categories for the month, largest first - at most 5, so
       * month.expense_minor minus their sum is what 「其餘分類」 shows. Optional on
       * purpose: ABSENT means "this database predates
       * 20261003090000_line_month_categories.sql" (the code can ship before
       * the migration) and is not the same as [] ("no spending") - a caller
       * must never read a missing list as an empty month. line_set_budget
       * answers in this same shape without it.
       */
      categories?: LineMonthCategoryTotal[];
    };

export async function lineMonthSummary(
  client: PostgrestClient,
  lineUserId: string,
  monthStart: string,
): Promise<LineMonthSummaryResult> {
  return client.rpc<LineMonthSummaryResult>("line_month_summary", {
    p_line_user_id: lineUserId,
    p_month_start: monthStart,
  });
}

/** line_set_budget answers in the same shape as line_month_summary. */
export type SetLineBudgetResult = LineMonthSummaryResult;

/**
 * 「預算 N」 / 「取消預算」. `budgetMinor: null` clears the budget. Always pass
 * null explicitly, never undefined: JSON.stringify drops an undefined key, and
 * PostgREST then cannot find the (text, integer, date) function.
 */
export async function setLineBudget(
  client: PostgrestClient,
  lineUserId: string,
  budgetMinor: number | null,
  monthStart: string,
): Promise<SetLineBudgetResult> {
  return client.rpc<SetLineBudgetResult>("line_set_budget", {
    p_line_user_id: lineUserId,
    p_budget_minor: budgetMinor,
    p_month_start: monthStart,
  });
}

/**
 * Per-LINE-user rate limit, sharing the same consume_rate_limit RPC the rest
 * of the app uses (see http/rateLimit.ts), but bucketed on a hash of the LINE
 * user id rather than a session/IP - the runtime limiter never sees this
 * traffic, since the webhook sits outside /api/v1.
 *
 * Fails OPEN, same posture as enforceRateLimit: a counter outage must not
 * turn into "the bot stopped recording anything."
 */
export async function consumeLineRateLimit(client: PostgrestClient, lineUserId: string): Promise<boolean> {
  try {
    const result = await client.rpc<{ allowed?: boolean }>("consume_rate_limit", {
      p_bucket: `lineMessage:${sha256Hex(lineUserId).slice(0, 16)}`,
      p_limit: 30,
      p_window_seconds: 60,
    });
    return result?.allowed !== false;
  } catch (error) {
    console.error("[line] rate limit counter unavailable, allowing message:", error);
    return true;
  }
}

/** Whether (and since when) the given Equo user has a LINE account linked - for the profile page and admin console. */
export async function getLineLinkForUser(
  client: PostgrestClient,
  userId: string,
): Promise<{ linked_at: string } | null> {
  const rows = await client.select<{ linked_at: string }>(
    "line_accounts",
    query(columns("linked_at"), eq("user_id", userId), limit(1)),
  );
  return rows[0] ?? null;
}
