import type { PostgrestClient } from "../db/postgrestClient.js";
import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import type { ExpensePageCursor } from "../repositories/expenseRepository.js";
import { EXPENSE_NOT_FOUND, InvalidMemberError, NOT_A_GROUP_MEMBER } from "../repositories/expenseRepository.js";
import { createSupabaseExpenseRepository } from "../repositories/supabaseExpenseRepository.js";
import {
  createSupabaseGroupRepository,
} from "../repositories/supabaseGroupRepository.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
  /**
   * Optional so this type stays compatible with call sites/tests that don't
   * care about storage cleanup; deleteExpenseRoute passes it through to
   * softDeleteExpense's orphaned-image cleanup hook when present (see
   * supabaseExpenseRepository.ts's cleanupOrphanedImage).
   */
  storage?: SupabaseStorageClient;
};

function forbidden(request_id: string) {
  return {
    ok: false,
    status: 403,
    body: {
      error: {
        code: "FORBIDDEN" as const,
        message: "You are not a member of this group.",
        request_id,
      },
    },
  };
}

/**
 * Maps the transactional write RPCs' sentinel failures onto the API's error
 * shape. Anything else is a genuine bug or an outage and is re-thrown, so the
 * runtime's 500 handler logs it with a request id instead of it being quietly
 * swallowed as a 4xx.
 */
function writeErrorResponse(error: unknown, request_id: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes(NOT_A_GROUP_MEMBER)) {
    return forbidden(request_id);
  }

  if (error instanceof InvalidMemberError) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_MEMBER" as const,
          message: error.message,
          request_id,
        },
      },
    };
  }

  if (message.includes(EXPENSE_NOT_FOUND)) {
    return {
      ok: false,
      status: 404,
      body: {
        error: {
          code: "EXPENSE_NOT_FOUND" as const,
          message: "This entry no longer exists.",
          request_id,
        },
      },
    };
  }

  throw error;
}


export async function createExpenseRoute(
  options: RouteOptions,
  groupId: string,
  request: CreateExpenseRequest,
) {
  const validation = validateCreateExpenseRequest(request);

  if (!validation.ok) {
    return { ok: false, status: 400, body: { issues: validation.issues } };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  try {
    const expense = await createSupabaseExpenseRepository(options.client).createExpense(
      auth.context,
      groupId,
      request,
    );

    // actorUserId rides along so the caller can fan out notifications without
    // verifying the session a second time. Not part of the HTTP body - the
    // runtime reads it off the result and drops it.
    return { ok: true, status: 201, body: { expense }, actorUserId: auth.context.user.id };
  } catch (error) {
    return writeErrorResponse(error, request.client_request_id);
  }
}

/**
 * PUT /api/v1/groups/:groupId/expenses/:expenseId - edit an entry.
 *
 * The client used to do this itself: DELETE the old expense, then POST the new
 * one. Two requests, no transaction between them - so a create that failed
 * after the delete succeeded (offline, a validation error, a retry colliding
 * with the idempotency index) destroyed the entry and put nothing in its place.
 * replace_expense does both halves in one database transaction.
 */
export async function replaceExpenseRoute(
  options: RouteOptions,
  groupId: string,
  expenseId: string,
  request: CreateExpenseRequest,
) {
  const validation = validateCreateExpenseRequest(request);

  if (!validation.ok) {
    return { ok: false, status: 400, body: { issues: validation.issues } };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  try {
    const { expense } = await createSupabaseExpenseRepository(options.client, options.storage).replaceExpense(
      auth.context,
      groupId,
      expenseId,
      request,
    );

    return { ok: true, status: 200, body: { expense } };
  } catch (error) {
    return writeErrorResponse(error, request.client_request_id);
  }
}

export async function deleteExpenseRoute(
  options: RouteOptions,
  groupId: string,
  expenseId: string,
  client_request_id: string,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  try {
    const expense = await createSupabaseExpenseRepository(options.client, options.storage).softDeleteExpense(
      auth.context,
      groupId,
      expenseId,
      client_request_id,
    );

    return { ok: true, status: 200, body: { expense } };
  } catch (error) {
    return writeErrorResponse(error, client_request_id);
  }
}

export type ListExpensesPageQuery = {
  limit?: number;
  before_date?: string;
  before_created_at?: string;
};

/**
 * GET /api/v1/groups/:groupId/expenses - the records-panel "load more" page,
 * membership-gated like every other per-group read (get_group_detail's RPC
 * does this check inline; a plain paged SELECT has no such built-in check,
 * so it's done explicitly here before touching the expense repository).
 */
export async function listExpensesPageRoute(
  options: RouteOptions,
  groupId: string,
  query: ListExpensesPageQuery,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const member = await createSupabaseGroupRepository(options.client).findActiveMember(groupId, auth.context.user.id);

  if (!member) {
    return forbidden("req_expenses_page");
  }

  const limit = Math.max(1, Math.min(query.limit ?? 50, 100));
  const cursor: ExpensePageCursor | undefined =
    query.before_date && query.before_created_at
      ? { beforeDate: query.before_date, beforeCreatedAt: query.before_created_at }
      : undefined;

  const expenses = await createSupabaseExpenseRepository(options.client).listExpensesPage(groupId, {
    limit,
    cursor,
  });

  return { ok: true, status: 200, body: { expenses } };
}

export type SearchExpensesQuery = {
  q?: string;
  member_id?: string;
  category?: string;
  kind?: string;
  from?: string;
  to?: string;
  limit?: number;
  before_date?: string;
  before_created_at?: string;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(["expense", "income", "settlement", "transfer"]);

/** "" is the UI's "all" for every dropdown; null tells the RPC to skip the clause. */
function orNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * GET /api/v1/groups/:groupId/expenses/search - the records-panel filter run
 * against the whole history instead of the loaded window.
 *
 * Unlike listExpensesPageRoute there is no explicit membership query here:
 * search_expenses does that check itself and returns null, which is the same
 * collapse of not-a-member and no-such-group used elsewhere.
 *
 * Malformed values are dropped rather than rejected - a bad date in a URL
 * should widen the search, not 400 at somebody mid-typing.
 */
export async function searchExpensesRoute(options: RouteOptions, groupId: string, query: SearchExpensesQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const kind = orNull(query.kind);
  const cursor: ExpensePageCursor | undefined =
    query.before_date && query.before_created_at
      ? { beforeDate: query.before_date, beforeCreatedAt: query.before_created_at }
      : undefined;

  const result = await createSupabaseExpenseRepository(options.client).searchExpenses(
    auth.context.user.id,
    groupId,
    {
      query: query.q?.trim() ?? "",
      memberId: orNull(query.member_id),
      category: orNull(query.category),
      kind: kind && KINDS.has(kind) ? kind : null,
      from: DATE_KEY.test(query.from ?? "") ? (query.from as string) : null,
      to: DATE_KEY.test(query.to ?? "") ? (query.to as string) : null,
    },
    { limit: Math.max(1, Math.min(query.limit ?? 50, 200)), cursor },
  );

  if (!result) {
    return forbidden("req_expenses_search");
  }

  return { ok: true, status: 200, body: result };
}
