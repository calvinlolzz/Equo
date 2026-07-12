import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import type { SupportRepository } from "./supportRepository.js";

export function createSupabaseSupportRepository(client: SupabaseQueryClient): SupportRepository {
  return {
    async createFeedback(userId, input) {
      return client.one<{ id: string }>(
        `
          insert into public.app_feedback (user_id, type, message, contact, page)
          values ($1, $2, $3, $4, $5)
          returning id
        `,
        [userId, input.type, input.message, input.contact, input.page],
      );
    },

    async recordClientError(userId, input) {
      await client.exec(
        `
          insert into public.app_error_logs (user_id, source, message, context, page)
          values ($1, $2, $3, $4, $5)
        `,
        [userId, input.source, input.message, input.context, input.page],
      );
    },
  };
}
