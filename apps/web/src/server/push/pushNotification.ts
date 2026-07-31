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
