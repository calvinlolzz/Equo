import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  RecurringExpenseInput,
  RecurringExpenseRecord,
  RecurringRepository,
} from "./recurringRepository.js";

/**
 * Membership and member-id validation live inside the RPCs (same contract as
 * create_expense, which raises NOT_A_GROUP_MEMBER / INVALID_MEMBER:<id>), so
 * the routes translate those sentinel messages rather than re-checking here.
 */
export function createSupabaseRecurringRepository(client: PostgrestClient): RecurringRepository {
  return {
    async list(userId, groupId) {
      const rows = await client.rpc<RecurringExpenseRecord[] | null>("list_recurring_expenses", {
        p_group_id: groupId,
        p_user_id: userId,
      });
      return rows ?? null;
    },

    upsert(userId, groupId, input: RecurringExpenseInput) {
      return client.rpc<RecurringExpenseRecord>("upsert_recurring_expense", {
        p_group_id: groupId,
        p_user_id: userId,
        p_payload: input,
      });
    },

    remove(userId, groupId, id) {
      return client.rpc<boolean>("delete_recurring_expense", {
        p_group_id: groupId,
        p_user_id: userId,
        p_id: id,
      });
    },
  };
}
