import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ScanLogEntry, ScanLogRepository } from "./scanLogRepository.js";

/**
 * The write side of receipt_scan_logs.
 *
 * A single jsonb argument rather than a column-per-parameter RPC, matching
 * upsert_recurring_expense: adding a measurement later is a change to this
 * object and the function body, not a new signature every caller has to move to.
 */
export function createSupabaseScanLogRepository(client: PostgrestClient): ScanLogRepository {
  return {
    async record(entry: ScanLogEntry) {
      await client.rpc<null>("log_receipt_scan", {
        p_payload: {
          user_id: entry.userId,
          model: entry.model,
          provider: entry.provider,
          outcome: entry.outcome,
          failure_reason: entry.failureReason ?? null,
          upstream_ms: entry.upstreamMs,
          image_bytes: entry.imageBytes,
          input_tokens: entry.inputTokens,
          output_tokens: entry.outputTokens,
          thought_tokens: entry.thoughtTokens,
          image_tokens: entry.imageTokens,
          attempts: entry.attempts,
          cost_micros: entry.costMicros,
        },
      });
    },
  };
}
