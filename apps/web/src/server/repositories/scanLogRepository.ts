/**
 * One row per receipt scan, for the console's usage panel.
 *
 * Nothing read off the receipt is recorded — not the merchant, not the total,
 * not the line items. What goes in is the shape of the call: which model, how
 * long the upstream took, how many tokens it billed, and whether it worked.
 */
export type ScanLogEntry = {
  /** The scanning user. Null only after that account is deleted. */
  userId: string | null;
  model: string;
  provider: string;
  /**
   * Three outcomes, not a boolean. "The model answered and said it could not
   * read this" is a camera problem; "the upstream failed" is an outage or a
   * quota. A single ok flag would merge the two numbers worth telling apart.
   */
  outcome: "recognised" | "unrecognised" | "failed";
  /** Our own exception message, for failures. Never contains the image. */
  failureReason?: string;
  upstreamMs: number;
  imageBytes: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  imageTokens: number | null;
  attempts: number;
  /** Estimated spend in millionths of a USD; null when tokens were not reported. */
  costMicros: number | null;
};

export type ScanLogRepository = {
  record(entry: ScanLogEntry): Promise<void>;
};
