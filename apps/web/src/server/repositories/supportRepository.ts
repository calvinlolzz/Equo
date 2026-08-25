export type CreateFeedbackInput = {
  type: string;
  message: string;
  contact: string | null;
  page: string | null;
};

export type ReportErrorInput = {
  source: string;
  message: string;
  context: string | null;
  page: string | null;
};

/**
 * The decision to alert, and the record of having done so, as one answer.
 * `alert: false` carries why — cooldown, hourly cap — which is worth logging.
 */
export type ErrorAlertClaim = {
  alert: boolean;
  reason: string;
  fingerprint?: string;
  occurrences_24h?: number;
};

export type SupportRepository = {
  createFeedback(userId: string, input: CreateFeedbackInput): Promise<{ id: string }>;
  /** Fire-and-forget client error row; userId is null for pre-login errors. */
  recordClientError(userId: string | null, input: ReportErrorInput): Promise<void>;
  /**
   * Atomically decide whether this crash is worth waking an operator for, and
   * record the decision. Asking and recording are one operation on purpose —
   * see claim_error_alert.
   */
  claimErrorAlert(source: string, message: string): Promise<ErrorAlertClaim>;
};
