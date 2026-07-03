import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
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

  const expense = await createSupabaseExpenseRepository(options.client).createExpense(
    auth.context,
    groupId,
    request,
  );

  return { ok: true, status: 201, body: { expense } };
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

  const expense = await createSupabaseExpenseRepository(options.client).softDeleteExpense(
    groupId,
    expenseId,
    client_request_id,
  );

  return { ok: true, status: 200, body: { expense } };
}
