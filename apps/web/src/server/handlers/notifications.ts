import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type {
  NotificationListRecord,
  NotificationReadResult,
  NotificationRepository,
} from "../repositories/notificationRepository.js";

type HandlerResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ApiError };

/**
 * How many rows the inbox returns.
 *
 * The panel is a list somebody scrolls once, not an archive: thirty covers
 * every announcement anyone has sent plus their support thread, and the count
 * in the badge is computed over everything regardless, so a longer history
 * would buy nothing but payload.
 */
export const NOTIFICATION_LIST_LIMIT = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keep only well-formed ids.
 *
 * A non-uuid would make the RPC's uuid[] parameter raise 22P02, which the
 * runtime turns into a 500 - the wrong answer for "mark these read". Anything
 * unrecognisable is dropped instead; the RPC already scopes the update to the
 * caller, so a dropped id and a stranger's id have the same effect.
 *
 * Capped because this is a list a client hands us and the effect of a long one
 * is a long IN list, not a bigger result.
 */
export function normalizeNotificationIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && UUID_RE.test(value)).slice(0, 100);
}

export async function handleListNotifications(
  repository: NotificationRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<NotificationListRecord>> {
  const page = await repository.list(context.user.id, NOTIFICATION_LIST_LIMIT);
  return { ok: true, status: 200, body: page };
}

/**
 * Mark rows read. An absent or empty `ids` means the whole inbox, which is what
 * opening the panel does.
 */
export async function handleMarkNotificationsRead(
  repository: NotificationRepository,
  context: AuthenticatedContext,
  body: { ids?: unknown } = {},
): Promise<HandlerResult<NotificationReadResult>> {
  const result = await repository.markRead(context.user.id, normalizeNotificationIds(body?.ids));
  return { ok: true, status: 200, body: result };
}
