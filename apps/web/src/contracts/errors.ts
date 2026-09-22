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
  /** Too many requests in the window. Carries a Retry-After header. */
  "RATE_LIMITED",
  /**
   * A well-formed account-deletion request that can't proceed yet — currently
   * only "you are the last admin-console owner; hand it over first".
   */
  "ACCOUNT_DELETE_BLOCKED",
  /**
   * The exchange-rate upstream is unreachable and no usable cached copy is
   * left. Advisory only — the composer falls back to its manual rate field,
   * so nothing the user was doing is blocked.
   */
  "EXCHANGE_RATE_UNAVAILABLE",
  /**
   * Receipt recognition is switched off (no ANTHROPIC_API_KEY on this
   * deployment) or the upstream failed. Advisory only — the client still
   * attaches the photo and opens the composer, so the scan is a shortcut that
   * degraded, not a lost expense.
   */
  "RECEIPT_SCAN_UNAVAILABLE",
  /**
   * Somebody already reminded this member recently (see handlers/nudge.ts's
   * NUDGE_COOLDOWN_SECONDS). Not a rate limit on the sender - the cooldown
   * belongs to the person being reminded.
   */
  "NUDGE_COOLDOWN",
  /** Nothing to remind them about: the target's balance is settled or positive. */
  "NUDGE_NOT_NEEDED",
  /**
   * Writes are paused while the operator works on the database. Reads still
   * succeed, so this is not an outage.
   *
   * **Retryable, and the client must treat it as such.** The offline queue
   * drops any write the server actively rejects, on the reasoning that
   * replaying a rejected write forever would wedge the queue - but a
   * maintenance window is temporary, and dropping somebody's expense because
   * they happened to reconnect during one would destroy data the app promised
   * to keep. See isRetryableError in apiClient.ts.
   */
  "MAINTENANCE",
  /**
   * A write attempted while an admin is looking at the app as another user.
   *
   * Not retryable, unlike MAINTENANCE: the answer is not "try later", it is
   * "leave the view". The offline queue must drop these rather than replay
   * them, or a mistaken keystroke during a support call would sit in a queue
   * waiting to be written to somebody else's ledger.
   */
  "VIEW_AS_READONLY",
  /**
   * A well-formed request that a personal ledger cannot take: invites,
   * members, archive, delete.
   */
  "PERSONAL_LEDGER",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export type ApiError = {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    /**
     * Machine-readable specifics for the few refusals a message cannot carry -
     * currently the groups that make an account merge impossible. Optional and
     * never required to render an error: a client that ignores it still shows
     * `message`, which always says the same thing in prose.
     */
    details?: Record<string, unknown>;
  };
};
