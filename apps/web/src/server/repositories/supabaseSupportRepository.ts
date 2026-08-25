import { columns, requireRow, type PostgrestClient } from "../db/postgrestClient.js";
import type { ErrorAlertClaim, SupportRepository } from "./supportRepository.js";

export function createSupabaseSupportRepository(client: PostgrestClient): SupportRepository {
  return {
    async createFeedback(userId, input) {
      return requireRow(
        await client.insert<{ id: string }>(
          "app_feedback",
          {
            user_id: userId,
            type: input.type,
            message: input.message,
            contact: input.contact,
            page: input.page,
          },
          { query: columns("id") },
        ),
        "feedback",
      );
    },

    async claimErrorAlert(source, message) {
      const result = await client.rpc<ErrorAlertClaim | null>("claim_error_alert", {
        p_message: message,
        p_source: source,
      });
      return result ?? { alert: false, reason: "unavailable" };
    },

    async recordClientError(userId, input) {
      await client.insert("app_error_logs", {
        user_id: userId,
        source: input.source,
        message: input.message,
        context: input.context,
        page: input.page,
      });
    },
  };
}
