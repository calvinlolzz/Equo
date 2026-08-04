import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { NudgeRepository, NudgeResult } from "../repositories/nudgeRepository.js";

type HandlerResult<T> =
  | { ok: true; status: number; body: T; notify?: NudgeNotification }
  | { ok: false; status: number; body: ApiError };

/**
 * What the delivery path needs to write the notification, handed back on the
 * result rather than in the HTTP body - the sender has no business seeing the
 * recipient's user id (see createExpenseRoute's actorUserId for the same
 * pattern).
 */
export type NudgeNotification = {
  groupId: string;
  toMemberId: string;
  groupName: string | null;
  fromName: string | null;
  balanceMinor: number;
  currency: string;
};

/**
 * How long one member of one group is left alone after being reminded.
 *
 * Six hours, so a morning reminder and an evening one are both possible and a
 * pile-on is not. It is deliberately long enough to be felt: the button exists
 * to prod somebody once, and an app that lets you send twenty is a harassment
 * tool with a splitting feature attached.
 */
export const NUDGE_COOLDOWN_SECONDS = 6 * 60 * 60;

function forbidden(request_id: string): HandlerResult<never> {
  return {
    ok: false,
    status: 403,
    body: { error: { code: "FORBIDDEN", message: "You are not a member of this group.", request_id } },
  };
}

export async function handleSendNudge(
  repository: NudgeRepository,
  context: AuthenticatedContext,
  groupId: string,
  memberId: string,
  request_id = "req_nudge",
): Promise<HandlerResult<{ nudge: { status: NudgeResult["status"] } }>> {
  const result = await repository.sendNudge(context.user.id, groupId, memberId, NUDGE_COOLDOWN_SECONDS);

  if (!result) {
    return forbidden(request_id);
  }

  if (result.status === "member_not_found") {
    return {
      ok: false,
      status: 404,
      body: { error: { code: "MEMBER_NOT_FOUND", message: "Member not found in this group.", request_id } },
    };
  }

  if (result.status === "invalid_target") {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_MEMBER",
          message: "Only another member with a linked account can be reminded.",
          request_id,
        },
      },
    };
  }

  if (result.status === "settled") {
    return {
      ok: false,
      status: 409,
      body: { error: { code: "NUDGE_NOT_NEEDED", message: "This member owes nothing.", request_id } },
    };
  }

  if (result.status === "cooldown") {
    return {
      ok: false,
      status: 409,
      body: {
        error: {
          code: "NUDGE_COOLDOWN",
          message: `This member was reminded recently. Try again in ${result.retry_after_seconds} seconds.`,
          request_id,
        },
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { nudge: { status: "sent" } },
    notify: {
      groupId,
      toMemberId: memberId,
      groupName: result.group_name,
      fromName: result.from_name,
      balanceMinor: result.balance_minor,
      currency: result.currency,
    },
  };
}
