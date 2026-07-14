import { columns, requireRow, type PostgrestClient } from "../db/postgrestClient.js";
import type { SupportRepository } from "./supportRepository.js";

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
