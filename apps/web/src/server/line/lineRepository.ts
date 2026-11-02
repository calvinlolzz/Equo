import type { PostgrestClient } from "../db/postgrestClient.js";
import { columns, eq, limit, query } from "../db/postgrestClient.js";
import { sha256Hex } from "./lineCrypto.js";

/**
 * Typed wrappers around the line_* RPCs from
 * supabase/migrations/20260929090000_line_bot.sql (and, for the budget
 * commands, 20260930090000_line_set_budget.sql, and, for the 「本月」
 * category breakdown, 20261003090000_line_month_categories.sql, and, for the
 * record card's 編輯/刪除 and the mood card's streak,
 * 20261101090100_line_entry_actions.sql, and, for the LIFF login's revocation
 * check, 20261102090000_line_liff_identity.sql). One function per RPC, named to
 * match, so a call site reads like the SQL it triggers.
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
 * One entry as the delete flow shows it: the fields of expense_json that the
 * confirm text needs. The RPCs return the whole expense_json object; extra
 * keys are simply not part of this contract.
 */
export type LineEntrySnapshot = {
  id: string;
  title: string;
  amount_minor: number;
  currency: string;
  kind: string;
  category: string;
  expense_date: string;
};

export type LineEntryStatusResult =
  | { ok: false; reason: "not_linked" | "account_disabled" }
  | { ok: true; status: "not_found" | "gone" }
  | { ok: true; status: "live"; edited: boolean; expense: LineEntrySnapshot };

/**
 * The ask step of the card's 刪除: what would be deleted right now? Read only.
 * `entryKey` is the LINE event key the entry was recorded under (the key that
 * line_record_entry stored as expenses.client_request_id = 'line:' || key);
 * it resolves only inside the sender's own personal ledger, and follows edits
 * made in the app. `edited` means "the row the card was made for has since
 * been replaced", so the confirm text can say the entry changed.
 */
export async function lineEntryStatus(
  client: PostgrestClient,
  lineUserId: string,
  entryKey: string,
): Promise<LineEntryStatusResult> {
  return client.rpc<LineEntryStatusResult>("line_entry_status", {
    p_line_user_id: lineUserId,
    p_entry_key: entryKey,
  });
}

export type DeleteLineEntryResult =
  | { ok: false; reason: "not_linked" | "account_disabled" | "not_found" | "already_gone" }
  | { ok: true; replay: boolean; edited?: boolean; expense: LineEntrySnapshot };

/**
 * The confirm step of the card's 刪除. `eventId` is the webhook event key of
 * THIS postback, not the card's: a redelivery of the same 確定刪除 answers
 * `replay: true` with the same expense instead of "already gone". Raises
 * LINE_INVALID_ENTRY (an RPC error, not a result) for a key or event id that
 * is not 8-80 of [A-Za-z0-9:_-].
 */
export async function deleteLineEntry(
  client: PostgrestClient,
  args: { lineUserId: string; entryKey: string; eventId: string },
): Promise<DeleteLineEntryResult> {
  return client.rpc<DeleteLineEntryResult>("line_delete_entry", {
    p_line_user_id: args.lineUserId,
    p_entry_key: args.entryKey,
    p_event_id: args.eventId,
  });
}

export type LineStreakResult =
  | { ok: false; reason: "not_linked" | "account_disabled" | "no_ledger" }
  | { ok: true; stats: unknown };

/**
 * The mood card's streak numbers. `stats` is deliberately `unknown`: it is the
 * raw line_ledger_stats object ({streak_days, week, today_index, month_days,
 * today_entries, total_entries}) and the caller must validate its shape before
 * trusting it (the card is optional garnish, never worth a crash). `today` is
 * the Taiwan calendar date, YYYY-MM-DD.
 */
export async function lineStreak(client: PostgrestClient, lineUserId: string, today: string): Promise<LineStreakResult> {
  return client.rpc<LineStreakResult>("line_streak", {
    p_line_user_id: lineUserId,
    p_today: today,
  });
}

export type LineEntryResolution =
  | { status: "not_found" }
  | { status: "gone" }
  | { status: "live"; group_id: string; expense_id: string; expense_date: string; edited: boolean };

/**
 * GET /api/v1/me/line/entries/:key. Takes the SESSION user's id (never a
 * request parameter): the key is looked up only in that user's personal
 * ledger, so a link carrying someone else's entry key resolves to not_found.
 */
export async function resolveLineEntryForUser(
  client: PostgrestClient,
  userId: string,
  entryKey: string,
): Promise<LineEntryResolution> {
  return client.rpc<LineEntryResolution>("line_entry_resolve", {
    p_user: userId,
    p_entry_key: entryKey,
  });
}

export type LineLiffIdentityResult =
  | { ok: false; reason: "not_linked" | "account_disabled" | "no_ledger" }
  | {
      ok: true;
      user: { id: string; google_sub: string; email: string; display_name: string; avatar_url: string | null };
      ledger_id: string;
      locale: string;
    };

/**
 * POST /api/v1/auth/line, the step after LINE has vouched for `lineUserId`:
 * which Equo user is that LINE account linked to, and which is their personal
 * ledger (created on first use). Takes only the LINE user id - never a user or
 * a group - so the identity can only be the one the link says it is. Anything
 * unlinked or malformed is `not_linked`; a disabled account never gets a ledger.
 */
export async function lineLiffIdentity(client: PostgrestClient, lineUserId: string): Promise<LineLiffIdentityResult> {
  return client.rpc<LineLiffIdentityResult>("line_liff_identity", { p_line_user_id: lineUserId });
}

/**
 * Is a LIFF session still good? True only while ALL of these hold: the user is
 * still linked to the LINE account whose id hashes to `lineSubHash`, the user is
 * enabled, and `ledgerId` is still their own live personal ledger. Unlinking,
 * relinking to another LINE account, an admin merge, disabling or deleting the
 * account each turn it false, so a LIFF token dies at once rather than at its
 * expiry. Anything but a literal `true` from the database counts as false.
 *
 * Throws when the database cannot be asked: the caller decides what an
 * unanswerable question means (the runtime gate fails closed).
 */
export async function liffLinkIsLive(
  client: PostgrestClient,
  claims: { auth_user_id: string; ledger_id: string; line_sub_hash: string },
): Promise<boolean> {
  const live = await client.rpc<unknown>("line_liff_link_live", {
    p_user: claims.auth_user_id,
    p_ledger: claims.ledger_id,
    p_line_sub_hash: claims.line_sub_hash,
  });

  return live === true;
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
