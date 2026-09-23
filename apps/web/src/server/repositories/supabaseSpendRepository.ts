import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  PersonalGroupSharesRecord,
  PersonalSharesRepository,
  SpendBreakdownRecord,
  SpendRepository,
} from "./spendRepository.js";

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

/**
 * The personal ledger home's "本月群組分攤" read. Like getSpendBreakdown, the
 * membership check and the amounts come back from one RPC round trip so they
 * cannot drift apart - see personal_month_group_shares's own header comment
 * for what counts.
 */
export function createSupabasePersonalSharesRepository(client: PostgrestClient): PersonalSharesRepository {
  return {
    async getMonthGroupShares(userId, month) {
      const result = await client.rpc<PersonalGroupSharesRecord | null>("personal_month_group_shares", {
        p_user: userId,
        p_month: month,
      });

      return result ?? null;
    },
  };
}
