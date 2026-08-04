import type { PostgrestClient } from "../db/postgrestClient.js";
import type { NudgeRepository, NudgeResult } from "./nudgeRepository.js";

/**
 * All of the decision-making lives in the send_nudge RPC: membership, the
 * target's balance, and the cooldown all have to be read and the row written
 * in one transaction, or two people tapping at once both get through.
 */
export function createSupabaseNudgeRepository(client: PostgrestClient): NudgeRepository {
  return {
    async sendNudge(userId, groupId, toMemberId, cooldownSeconds) {
      const result = await client.rpc<NudgeResult | null>("send_nudge", {
        p_user: userId,
        p_group_id: groupId,
        p_to_member_id: toMemberId,
        p_cooldown_seconds: cooldownSeconds,
      });

      return result ?? null;
    },
  };
}
