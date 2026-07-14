import type { PostgrestClient } from "../db/postgrestClient.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseSupportRepository } from "../repositories/supabaseSupportRepository.js";
import {
  handleCreateFeedback,
  handleReportError,
  type CreateFeedbackRequest,
  type ReportErrorRequest,
} from "../handlers/support.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

export async function createFeedbackRoute(options: RouteOptions, request: CreateFeedbackRequest) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleCreateFeedback(createSupabaseSupportRepository(options.client), auth.context, request);
}

/**
 * Error intake accepts anonymous reports: the login wall means most traffic
 * is authenticated, but crashes BEFORE login are exactly the ones worth
 * hearing about. A valid session token attributes the row via its
 * resolved_user_id; anything else records user_id null. No DB user lookup is
 * ever made just to attribute an error report.
 */
export async function reportErrorRoute(options: RouteOptions, request: ReportErrorRequest) {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier).catch(() => null);
  const userId = identity?.resolved_user_id ?? null;

  return handleReportError(createSupabaseSupportRepository(options.client), userId, request);
}
