import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
import { InvalidMemberError, NOT_A_GROUP_MEMBER } from "../repositories/expenseRepository.js";
import { createSupabaseExpenseRepository } from "../repositories/supabaseExpenseRepository.js";
import {
  type SupabaseQueryClient,
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";

type RouteOptions = {
  client: SupabaseQueryClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
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
    const expense = await createSupabaseExpenseRepository(options.client).softDeleteExpense(
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
