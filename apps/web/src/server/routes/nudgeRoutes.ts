import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseNudgeRepository } from "../repositories/supabaseNudgeRepository.js";
import { handleSendNudge } from "../handlers/nudge.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/**
 * POST /api/v1/groups/:groupId/members/:memberId/nudge
 *
 * No client_request_id: this is not an idempotent write in the ledger sense.
 * Re-sending is meant to be possible (people do get reminded twice), and the
 * thing that stops a double-tap from sending two notifications is the
 * cooldown inside the RPC, which is a property of the recipient rather than of
 * one request.
 */
export async function sendNudgeRoute(options: RouteOptions, groupId: string, memberId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return handleSendNudge(createSupabaseNudgeRepository(options.client), auth.context, groupId, memberId);
}
