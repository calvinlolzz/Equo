import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabasePushRepository } from "../repositories/supabasePushRepository.js";
import {
  handleSubscribePush,
  handleUnsubscribePush,
  type PushSubscribeRequest,
} from "../handlers/push.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

export async function subscribePushRoute(options: RouteOptions, request: PushSubscribeRequest) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleSubscribePush(createSupabasePushRepository(options.client), auth.context, request);
}

export async function unsubscribePushRoute(options: RouteOptions, request: { endpoint?: string }) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleUnsubscribePush(createSupabasePushRepository(options.client), auth.context, request);
}

/**
 * GET /api/v1/push/public-key
 *
 * The VAPID public key, served rather than baked into the bundle at build
 * time: rotating the keypair then needs an env change and a redeploy of the
 * function, not a rebuild of the front end. Public by definition - it is the
 * half every push service is told anyway - but still behind the session wall,
 * since only a logged-in page has any use for it.
 *
 * Returns 200 with `enabled: false` rather than an error when the key is not
 * configured: "this deployment has push switched off" is a normal state the UI
 * has to render, not a failure.
 */
export async function pushPublicKeyRoute(options: RouteOptions, publicKey: string | undefined) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return {
    ok: true as const,
    status: 200,
    body: publicKey ? { enabled: true, public_key: publicKey } : { enabled: false },
  };
}
