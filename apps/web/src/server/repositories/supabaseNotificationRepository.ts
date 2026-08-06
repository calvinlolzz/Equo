import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  NotificationDeleteResult,
  NotificationListRecord,
  NotificationReadResult,
  NotificationRepository,
} from "./notificationRepository.js";

export function createSupabaseNotificationRepository(client: PostgrestClient): NotificationRepository {
  return {
    list(userId, limit) {
      return client.rpc<NotificationListRecord>("notifications_list", {
        p_user_id: userId,
        p_limit: limit,
      });
    },

    markRead(userId, ids) {
      // The RPC reads an empty array as "everything unread", so an empty list
      // is passed through rather than turned into a second call shape.
      return client.rpc<NotificationReadResult>("notifications_mark_read", {
        p_user_id: userId,
        p_ids: ids,
      });
    },

    remove(userId, ids) {
      return client.rpc<NotificationDeleteResult>("notifications_delete", {
        p_user_id: userId,
        p_ids: ids,
      });
    },
  };
}
