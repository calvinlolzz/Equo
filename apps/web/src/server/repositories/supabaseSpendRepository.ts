import type { PostgrestClient } from "../db/postgrestClient.js";
import type { SpendBreakdownRecord, SpendRepository } from "./spendRepository.js";

/**
 * Membership, period bucketing and the personal/group split all happen inside
 * get_spend_breakdown - one round trip, and the "am I allowed to see this"
 * check cannot drift from the numbers it guards.
 */
export function createSupabaseSpendRepository(client: PostgrestClient): SpendRepository {
  return {
    async getSpendBreakdown(userId, groupId, periodKind, periodKey) {
      const result = await client.rpc<SpendBreakdownRecord | null>("get_spend_breakdown", {
        p_group_id: groupId,
        p_user_id: userId,
        p_period_kind: periodKind,
        p_period_key: periodKey,
      });

      return result ?? null;
    },
  };
}
