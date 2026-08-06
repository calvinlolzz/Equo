import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseNotificationRepository } from "../repositories/supabaseNotificationRepository.js";
import {
  handleDeleteNotifications,
  handleListNotifications,
  handleMarkNotificationsRead,
} from "../handlers/notifications.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/** GET /api/v1/notifications - the signed-in user's own inbox, newest first. */
export async function listNotificationsRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return handleListNotifications(createSupabaseNotificationRepository(options.client), auth.context);
}

/**
 * POST /api/v1/notifications/read - mark rows read.
 *
 * A POST rather than a PATCH on each row: the common case is "the panel was
 * opened, all of it is read", and that should be one request rather than one
 * per unread item.
 */
export async function markNotificationsReadRoute(options: RouteOptions, body: { ids?: unknown }) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return handleMarkNotificationsRead(createSupabaseNotificationRepository(options.client), auth.context, body);
}

/**
 * DELETE /api/v1/notifications - remove rows from the caller's own inbox.
 *
 * The ids travel in the body rather than the path because 清空 is the common
 * case and it has no id to put there.
 */
export async function deleteNotificationsRoute(options: RouteOptions, body: { ids?: unknown }) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return handleDeleteNotifications(createSupabaseNotificationRepository(options.client), auth.context, body);
}
