import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { PushRepository } from "../repositories/pushRepository.js";

type HandlerResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ApiError };

function malformed(message: string, request_id: string): HandlerResult<never> {
  return {
    ok: false,
    status: 400,
    body: { error: { code: "MALFORMED_REQUEST", message, request_id } },
  };
}

export type PushSubscribeRequest = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  user_agent?: string;
  /**
   * The language to write this device's notifications in. Optional: a cached
   * bundle from before translation shipped does not send it, and the column
   * keeps whatever it already had rather than being cleared.
   *
   * Unvalidated here on purpose - the CHECK on push_subscriptions.locale is the
   * allow-list, so an unknown value is rejected by the database rather than
   * quietly stored and later used to pick a dictionary that does not exist.
   */
  locale?: string;
};

/**
 * A subscription is only usable with all three parts, and the endpoint has to
 * be an https URL - it is a URL this server will later POST to, so anything
 * else is either a broken client or someone trying to point the delivery path
 * at a host of their choosing.
 */
export function validatePushSubscription(request: PushSubscribeRequest): string | null {
  const endpoint = request.endpoint?.trim();

  if (!endpoint) return "endpoint is required";

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return "endpoint must be a URL";
  }

  if (parsed.protocol !== "https:") return "endpoint must be https";
  if (!request.keys?.p256dh?.trim()) return "keys.p256dh is required";
  if (!request.keys?.auth?.trim()) return "keys.auth is required";

  return null;
}

export async function handleSubscribePush(
  repository: PushRepository,
  context: AuthenticatedContext,
  request: PushSubscribeRequest,
  request_id = "req_push",
): Promise<HandlerResult<{ ok: true }>> {
  const issue = validatePushSubscription(request);

  if (issue) {
    return malformed(issue, request_id);
  }

  await repository.saveSubscription(context.user.id, {
    endpoint: request.endpoint!.trim(),
    p256dh: request.keys!.p256dh!.trim(),
    auth: request.keys!.auth!.trim(),
    userAgent: request.user_agent?.slice(0, 300),
    locale: request.locale,
  });

  return { ok: true, status: 200, body: { ok: true } };
}

export async function handleUnsubscribePush(
  repository: PushRepository,
  context: AuthenticatedContext,
  request: { endpoint?: string },
  request_id = "req_push",
): Promise<HandlerResult<{ ok: true }>> {
  const endpoint = request.endpoint?.trim();

  if (!endpoint) {
    return malformed("endpoint is required", request_id);
  }

  // Deleting nothing is still success: the caller's goal is "this device is no
  // longer subscribed", and it already is.
  await repository.deleteSubscription(context.user.id, endpoint);

  return { ok: true, status: 200, body: { ok: true } };
}
