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
  "INTERNAL_ERROR",
  "INVALID_IMAGE",
  "ADMIN_FORBIDDEN",
  "ADMIN_NOT_FOUND",
  /** A well-formed admin request that conflicts with an invariant (last owner). */
  "ADMIN_CONFLICT",
  "ACCOUNT_DISABLED",
  "INVALID_FEEDBACK",
  "INVALID_ADMIN",
  /**
   * The request body is not the shape the endpoint takes at all - a missing
   * field, a string where an array belongs, an empty `{}`. Distinct from the
   * INVALID_* codes, which mean the shape was right and a value was wrong.
   */
  "MALFORMED_REQUEST",
  /**
   * A well-formed account-deletion request that can't proceed yet — currently
   * only "you are the last admin-console owner; hand it over first".
   */
  "ACCOUNT_DELETE_BLOCKED",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export type ApiError = {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
  };
};
