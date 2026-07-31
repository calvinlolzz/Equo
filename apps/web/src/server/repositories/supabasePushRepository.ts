import type { PostgrestClient } from "../db/postgrestClient.js";
import type { PushRepository, PushTargetsRecord } from "./pushRepository.js";

/**
 * Push subscription storage, through the same service-role RPC pattern the
 * rest of the server uses. Nothing here is reachable from the browser: the
 * table is RLS-denied and every function is granted to service_role only.
 */
export function createSupabasePushRepository(client: PostgrestClient): PushRepository {
  return {
    async saveSubscription(userId, subscription) {
      const result = await client.rpc<{ id: string; endpoint: string }>("upsert_push_subscription", {
        p_user: userId,
        p_endpoint: subscription.endpoint,
        p_p256dh: subscription.p256dh,
        p_auth: subscription.auth,
        p_user_agent: subscription.userAgent ?? null,
      });
      return { endpoint: result.endpoint };
    },

    async deleteSubscription(userId, endpoint) {
      return client.rpc<{ deleted: number }>("delete_push_subscription", {
        p_user: userId,
        p_endpoint: endpoint,
      });
    },

    async pruneSubscription(endpoint) {
      return client.rpc<{ deleted: number }>("prune_push_subscription", {
        p_endpoint: endpoint,
      });
    },

    async targetsForGroup(groupId, actorUserId) {
      const result = await client.rpc<PushTargetsRecord>("push_targets_for_group", {
        p_group_id: groupId,
        p_actor: actorUserId,
      });
      return {
        group_name: result?.group_name ?? null,
        actor_name: result?.actor_name ?? null,
        subscriptions: result?.subscriptions ?? [],
      };
    },
  };
}
