export const errorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "GROUP_ARCHIVED",
  "GROUP_DELETED",
  "MEMBER_NOT_FOUND",
  "INVALID_MEMBER",
  "MEMBER_HAS_BALANCE",
  "INVALID_AMOUNT",
  "PAYMENT_TOTAL_MISMATCH",
  "EXPENSE_SHARE_TOTAL_MISMATCH",
  "IDEMPOTENCY_CONFLICT",
  "SETTLEMENT_VERSION_CONFLICT",
  "INVITE_EXPIRED",
  "INVITE_REVOKED",
  "RUNTIME_ENV_MISSING",
  "INVALID_IMAGE",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export type ApiError = {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
  };
};
