// One formatter for money, shared with the screen. A notification that says
// $1,200 while the app says $1200.00 is the kind of small disagreement that
// makes people distrust both.
import { formatAmount } from "../../app/formatAmount.js";

export type PushNotificationPayload = {
  title: string;
  body: string;
  /** Where a tap lands. Same-origin path, resolved by the service worker. */
  url: string;
  /**
   * Collapse key. One per group, so five entries recorded in a row replace
   * each other on the lock screen instead of stacking into a wall.
   */
  tag: string;
};

const FALLBACK_GROUP_NAME = "Equo";
const FALLBACK_ACTOR_NAME = "有人";

/**
 * The text for "somebody recorded something in a group you are in".
 *
 * Deliberately says what happened and how much, and nothing else: a
 * notification is read on a lock screen by someone who has not opened the app,
 * so the group and the amount are the two facts that decide whether they care
 * enough to tap.
 */
export function buildExpenseNotification({
  groupId,
  groupName,
  actorName,
  title,
  amountMinor,
  currency,
  kind,
}: {
  groupId: string;
  groupName: string | null;
  actorName: string | null;
  title: string;
  amountMinor: number;
  currency: string;
  kind: string;
}): PushNotificationPayload {
  const who = actorName?.trim() || FALLBACK_ACTOR_NAME;
  const amount = formatAmount(amountMinor, currency);
  const entryTitle = title.trim();

  const body =
    kind === "transfer"
      ? `${who} 記錄了一筆清償 ${amount}`
      : kind === "income"
        ? `${who} 記了一筆收入：${entryTitle} ${amount}`
        : `${who} 記了一筆：${entryTitle} ${amount}`;

  return {
    title: groupName?.trim() || FALLBACK_GROUP_NAME,
    body,
    url: `/group/${groupId}`,
    tag: `group-${groupId}`,
  };
}

/**
 * "Somebody reminded you to settle up."
 *
 * Names the sender and the amount, because a reminder that says only "you owe
 * money" makes the receiver open the app to find out who is asking - and the
 * whole point is to let them decide, on the lock screen, whether to pay now.
 *
 * The amount is stated as a positive number: the receiver's balance is
 * negative, but "你還有 -NT$300 未結清" is arithmetic, not a sentence.
 *
 * Its own tag, so a reminder never silently replaces (or is replaced by) the
 * group's entry notifications.
 */
export function buildNudgeNotification({
  groupId,
  groupName,
  fromName,
  balanceMinor,
  currency,
}: {
  groupId: string;
  groupName: string | null;
  fromName: string | null;
  /** The receiver's balance - negative, since only a debtor can be nudged. */
  balanceMinor: number;
  currency: string;
}): PushNotificationPayload {
  const who = fromName?.trim() || FALLBACK_ACTOR_NAME;
  const amount = formatAmount(Math.abs(balanceMinor), currency);

  return {
    title: groupName?.trim() || FALLBACK_GROUP_NAME,
    body: `${who} 提醒你還有 ${amount} 未結清`,
    url: `/group/${groupId}`,
    tag: `nudge-${groupId}`,
  };
}

/**
 * "Somebody joined the group."
 *
 * Worth a notification because it is the one event where the people already in
 * the group have something to do about it: an invite link that has been
 * accepted by the wrong person is only fixable if anybody notices.
 */
export function buildMemberJoinedNotification({
  groupId,
  groupName,
  memberName,
}: {
  groupId: string;
  groupName: string | null;
  memberName: string | null;
}): PushNotificationPayload {
  const who = memberName?.trim() || FALLBACK_ACTOR_NAME;

  return {
    title: groupName?.trim() || FALLBACK_GROUP_NAME,
    body: `${who} 加入了群組`,
    url: `/group/${groupId}`,
    tag: `group-${groupId}`,
  };
}
