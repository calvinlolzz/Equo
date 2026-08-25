// One formatter for money, shared with the screen. A notification that says
// $1,200 while the app says $1200.00 is the kind of small disagreement that
// makes people distrust both.
import { formatAmount } from "../../app/formatAmount.js";

/**
 * A button under the notification.
 *
 * Carries its own destination rather than an id the worker has to know how to
 * translate: the notification is built here, and a worker that had to keep a
 * table of action ids in sync with this file would drift the first time one was
 * added. `url` is stashed in the notification's `data` and read back on click.
 */
export type PushNotificationAction = {
  /** Id echoed back as event.action. */
  action: string;
  /** Button label. */
  title: string;
  /** Same-origin path this button opens. */
  url: string;
};

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
  /**
   * Optional buttons. Only worth adding where the button goes somewhere the
   * notification body wouldn't have — a second route to the same screen is
   * clutter on a lock screen, not a feature.
   */
  actions?: PushNotificationAction[];
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
    // The one action worth a button anywhere in this file. "Somebody recorded
    // the lunch" is most often read by the person who paid for the coffee, and
    // the thing they want next is the composer, not the group screen the body
    // tap already gives them. Reuses the existing ?shortcut= entry point, so
    // there is nothing new for the app to understand.
    actions: [{ action: "add-expense", title: "記一筆", url: `/group/${groupId}?shortcut=add-expense` }],
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
 *
 * No action button, deliberately. The group screen the body tap opens already
 * shows this debt with its 結清 button on it, so "去結清" would be a second
 * route to the same place; and the button that would genuinely help — marking
 * it paid from the lock screen — moves money in the ledger on a single stray
 * tap, with no chance to check the amount. That belongs behind the app.
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

/** How much of the crash message fits on a lock screen before it is just noise. */
const ERROR_ALERT_MESSAGE_MAX = 90;

/**
 * "The app is throwing an error" -> the operators, not the users.
 *
 * The only notification in the product aimed at an administrator, and the one
 * with a genuinely different job: the others tell you something happened, this
 * one asks you to go and look. So it carries the two facts that decide whether
 * to open the laptop now or after dinner — what broke, and whether it is
 * happening to one person or to everyone — and links straight to the
 * fingerprint's drill-down rather than the console's front page.
 *
 * The tag is per-fingerprint so a recurrence replaces the earlier card instead
 * of stacking; the cooldown already means that is rare, but a lock screen with
 * two copies of the same bug reads as twice the problem.
 */
export function buildErrorAlertNotification({
  fingerprint,
  message,
  occurrences,
  isNew,
}: {
  fingerprint: string;
  message: string;
  /** Occurrences in the last 24h, so one-off vs everyone-is-hitting-it is visible. */
  occurrences: number;
  /** First time this bug has ever been seen, as opposed to one that came back. */
  isNew: boolean;
}): PushNotificationPayload {
  const trimmed = message.trim().replace(/\s+/g, " ");
  const summary =
    trimmed.length > ERROR_ALERT_MESSAGE_MAX
      ? `${trimmed.slice(0, ERROR_ALERT_MESSAGE_MAX - 1)}…`
      : trimmed;

  return {
    title: isNew ? "Equo 出現新錯誤" : "Equo 錯誤又出現了",
    body: occurrences > 1 ? `${summary}（24 小時內 ${occurrences} 次）` : summary,
    // The console reads the fingerprint from `err`, not `fingerprint` (see
    // adminRoute.ts) — the obvious guess lands on the unfiltered error list.
    url: `/admin?tab=errors&err=${encodeURIComponent(fingerprint)}`,
    tag: `error-${fingerprint}`,
  };
}
