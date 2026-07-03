import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
import {
  type SupabaseQueryClient,
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";
import { createSupabaseSettlementRepository } from "../repositories/supabaseSettlementRepository.js";

type RouteOptions = {
  client: SupabaseQueryClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

async function buildSettlementRouteContext(options: RouteOptions) {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier);
  return requireAuthenticatedUser(identity, (googleIdentity) =>
    upsertUserByGoogleIdentity(options.client, googleIdentity),
  );
}

export async function calculateSettlementRoute(options: RouteOptions, groupId: string) {
  const auth = await buildSettlementRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const result = await createSupabaseSettlementRepository(options.client).calculateCurrentSettlement(
    auth.context,
    groupId,
  );

  return { ok: true, status: 201, body: result };
}

export async function confirmSettlementRoute(
  options: RouteOptions,
  groupId: string,
  settlementId: string,
  request: ConfirmSettlementRequest,
) {
  const settlement_version = request.settlement_version;
  const auth = await buildSettlementRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  try {
    const settlement = await createSupabaseSettlementRepository(options.client).confirmSettlement(
      auth.context,
      groupId,
      settlementId,
      { ...request, settlement_version },
    );

    return { ok: true, status: 200, body: { settlement } };
  } catch (error) {
    if (error instanceof Error && error.message === "SETTLEMENT_VERSION_CONFLICT") {
      return {
        ok: false,
        status: 409,
        body: {
          error: {
            code: "SETTLEMENT_VERSION_CONFLICT",
            message: "Settlement version has changed. Recalculate before confirming.",
            request_id: request.client_request_id,
          },
        },
      };
    }

    throw error;
  }
}
