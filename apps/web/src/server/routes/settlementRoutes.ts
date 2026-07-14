import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { NOT_A_GROUP_MEMBER } from "../repositories/settlementRepository.js";
import { createSupabaseSettlementRepository } from "../repositories/supabaseSettlementRepository.js";

type RouteOptions = {
  client: PostgrestClient;
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


export async function calculateSettlementRoute(options: RouteOptions, groupId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  try {
    const result = await createSupabaseSettlementRepository(options.client).calculateCurrentSettlement(
      auth.context,
      groupId,
    );

    return { ok: true, status: 201, body: result };
  } catch (error) {
    if (error instanceof Error && error.message === NOT_A_GROUP_MEMBER) {
      return forbidden("req_calculate_settlement");
    }

    throw error;
  }
}

export async function confirmSettlementRoute(
  options: RouteOptions,
  groupId: string,
  settlementId: string,
  request: ConfirmSettlementRequest,
) {
  const settlement_version = request.settlement_version;
  const auth = await buildAuthContext(options);

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
    if (error instanceof Error && error.message === NOT_A_GROUP_MEMBER) {
      return forbidden(request.client_request_id);
    }

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
