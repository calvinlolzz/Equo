import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import type { RecurringExpenseInput } from "../repositories/recurringRepository.js";
import { createSupabaseRecurringRepository } from "../repositories/supabaseRecurringRepository.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

function apiError(status: number, code: string, message: string, request_id: string) {
  return { ok: false as const, status, body: { error: { code, message, request_id } } };
}

/**
 * The RPCs signal business failures by raising bare sentinel messages, the same
 * convention the expense write RPCs use. Translate them into the typed errors
 * the client's describeCloudActionError already knows how to phrase.
 */
function translate(error: unknown, request_id: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("NOT_A_GROUP_MEMBER")) {
    return apiError(403, "FORBIDDEN", "You are not a member of this group.", request_id);
  }
  if (message.includes("RECURRING_NOT_FOUND")) {
    return apiError(404, "NOT_FOUND", "That recurring expense no longer exists.", request_id);
  }
  if (message.includes("INVALID_DAY_OF_MONTH")) {
    return apiError(400, "INVALID_DAY_OF_MONTH", "Pick a day between 1 and 28.", request_id);
  }
  if (message.includes("INVALID_SHARES")) {
    return apiError(400, "INVALID_SHARES", "Pick at least one person to split with.", request_id);
  }
  const invalidMember = /INVALID_MEMBER:\s*(\S+)/.exec(message);
  if (invalidMember) {
    return apiError(400, "INVALID_MEMBER", `Member ${invalidMember[1]} is not in this group.`, request_id);
  }
  throw error;
}

/**
 * Validated here rather than only in SQL so a malformed body gets a 400 with a
 * usable code instead of a raised sentinel; the RPC re-checks everything it
 * cares about anyway (it is the only thing standing between a payload and the
 * table).
 */
function readInput(body: unknown): RecurringExpenseInput | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const amount = input.amount_minor;
  const payer = input.payer_member_id;
  const shares = input.share_member_ids;
  const day = input.day_of_month;

  if (!title) return null;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return null;
  if (typeof payer !== "string" || !payer) return null;
  if (!Array.isArray(shares) || shares.length === 0 || !shares.every((id) => typeof id === "string" && id)) return null;
  if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 28) return null;

  return {
    id: typeof input.id === "string" && input.id ? input.id : undefined,
    title,
    amount_minor: amount,
    currency: typeof input.currency === "string" ? input.currency : undefined,
    category: typeof input.category === "string" ? input.category : undefined,
    note: typeof input.note === "string" ? input.note : null,
    payer_member_id: payer,
    share_member_ids: shares as string[],
    day_of_month: day,
    active: typeof input.active === "boolean" ? input.active : undefined,
  };
}

/** GET /api/v1/groups/:groupId/recurring */
export async function listRecurringRoute(options: RouteOptions, groupId: string) {
  const auth = await buildAuthContext(options);
  if (auth.ok === false) return { ok: false as const, status: 401, body: auth.error };

  const rows = await createSupabaseRecurringRepository(options.client).list(auth.context.user.id, groupId);

  if (!rows) {
    return apiError(403, "FORBIDDEN", "You are not a member of this group.", "req_recurring_list");
  }

  return { ok: true as const, status: 200, body: { recurring: rows } };
}

/** POST /api/v1/groups/:groupId/recurring — creates, or updates when the body carries an id. */
export async function upsertRecurringRoute(options: RouteOptions, groupId: string, body: unknown) {
  const auth = await buildAuthContext(options);
  if (auth.ok === false) return { ok: false as const, status: 401, body: auth.error };

  const input = readInput(body);
  if (!input) {
    return apiError(400, "INVALID_RECURRING", "That recurring expense is incomplete.", "req_recurring_upsert");
  }

  try {
    const rule = await createSupabaseRecurringRepository(options.client).upsert(auth.context.user.id, groupId, input);
    return { ok: true as const, status: input.id ? 200 : 201, body: { recurring: rule } };
  } catch (error) {
    return translate(error, "req_recurring_upsert");
  }
}

/** DELETE /api/v1/groups/:groupId/recurring/:id */
export async function deleteRecurringRoute(options: RouteOptions, groupId: string, id: string) {
  const auth = await buildAuthContext(options);
  if (auth.ok === false) return { ok: false as const, status: 401, body: auth.error };

  try {
    const removed = await createSupabaseRecurringRepository(options.client).remove(auth.context.user.id, groupId, id);
    if (!removed) {
      return apiError(404, "NOT_FOUND", "That recurring expense no longer exists.", "req_recurring_delete");
    }
    return { ok: true as const, status: 200, body: { deleted: true } };
  } catch (error) {
    return translate(error, "req_recurring_delete");
  }
}
