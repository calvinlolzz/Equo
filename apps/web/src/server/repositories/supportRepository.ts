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

export type SupportRepository = {
  createFeedback(userId: string, input: CreateFeedbackInput): Promise<{ id: string }>;
  /** Fire-and-forget client error row; userId is null for pre-login errors. */
  recordClientError(userId: string | null, input: ReportErrorInput): Promise<void>;
};
