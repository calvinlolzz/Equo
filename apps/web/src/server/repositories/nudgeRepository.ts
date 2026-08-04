/**
 * "Pay me back" reminders.
 *
 * Every refusal is a status rather than an exception, because each one is a
 * different sentence to the person who pressed the button - and none of them
 * is a failure worth a 500.
 */
export type NudgeResult =
  | {
      status: "sent";
      group_name: string | null;
      /** The sender's display name in this group - what the notification says. */
      from_name: string | null;
      to_user_id: string;
      to_name: string | null;
      /** The target's balance, negative (they owe), in the group's currency. */
      balance_minor: number;
      currency: string;
    }
  /** Somebody already reminded them recently. Carries the wait in seconds. */
  | { status: "cooldown"; retry_after_seconds: number }
  /** The target owes nothing. Nothing to remind them about. */
  | { status: "settled" }
  | { status: "member_not_found" }
  /** Yourself, or a virtual member with no account to notify. */
  | { status: "invalid_target" };

export type NudgeRepository = {
  /**
   * Send one reminder. Returns null when the caller is not an active member of
   * a live group - which the route turns into the same 403 a non-member gets,
   * so a group you are not in is indistinguishable from one that isn't there.
   */
  sendNudge(
    userId: string,
    groupId: string,
    toMemberId: string,
    cooldownSeconds: number,
  ): Promise<NudgeResult | null>;
};
