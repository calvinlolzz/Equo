import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
import type { ExpensePageCursor } from "../repositories/expenseRepository.js";
import { InvalidMemberError, NOT_A_GROUP_MEMBER } from "../repositories/expenseRepository.js";
import { createSupabaseExpenseRepository } from "../repositories/supabaseExpenseRepository.js";
import {
  createSupabaseGroupRepository,
  type SupabaseQueryClient,
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

type RouteOptions = {
  client: SupabaseQueryClient;
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

async function buildExpenseRouteContext(options: RouteOptions) {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier);
  return requireAuthenticatedUser(identity, (googleIdentity) =>
    upsertUserByGoogleIdentity(options.client, googleIdentity),
  );
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

  const auth = await buildExpenseRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  try {
    const expense = await createSupabaseExpenseRepository(options.client).createExpense(
      auth.context,
      groupId,
      request,
    );

    return { ok: true, status: 201, body: { expense } };
  } catch (error) {
    if (error instanceof Error && error.message === NOT_A_GROUP_MEMBER) {
      return forbidden(request.client_request_id);
    }

    if (error instanceof InvalidMemberError) {
      return {
        ok: false,
        status: 400,
        body: {
          error: {
            code: "INVALID_MEMBER" as const,
            message: error.message,
            request_id: request.client_request_id,
          },
        },
      };
    }

    throw error;
  }
}

export async function deleteExpenseRoute(
  options: RouteOptions,
  groupId: string,
  expenseId: string,
  client_request_id: string,
) {
  const auth = await buildExpenseRouteContext(options);

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
    if (error instanceof Error && error.message === NOT_A_GROUP_MEMBER) {
      return forbidden(client_request_id);
    }

    throw error;
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
  const auth = await buildExpenseRouteContext(options);

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
