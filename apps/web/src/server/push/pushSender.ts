import type { PushRepository, PushSubscriptionRecord } from "../repositories/pushRepository.js";
import {
  buildAutoNudgeNotification,
  buildErrorAlertNotification,
  buildExpenseNotification,
  buildMemberJoinedNotification,
  buildNudgeNotification,
  type PushNotificationPayload,
} from "./pushNotification.js";

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  /** RFC 8292 "sub": a mailto: or https: URL identifying who is sending. */
  subject: string;
};

export type PushSendResult = { statusCode: number };

export type PushSendFn = (
  subscription: PushSubscriptionRecord,
  payload: PushNotificationPayload,
  vapid: VapidKeys,
) => Promise<PushSendResult>;

export type PushDeliveryOutcome = {
  sent: number;
  /** Endpoints the push service said are gone; deleted, not retried. */
  pruned: number;
  failed: number;
};

/**
 * Status codes that mean "this endpoint will never work again".
 *
 * Everything else - a 429, a 500, a timeout - is transient, and the row stays:
 * a browser that is merely unreachable right now must not lose its
 * subscription, because the user would have to notice and re-enable it.
 */
function isGone(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

function statusCodeOf(error: unknown): number | null {
  const value = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof value === "number" ? value : null;
}

/**
 * The default transport: web-push, imported lazily so the module never loads
 * in a unit test (or in a deployment where push is switched off).
 */
export const sendWithWebPush: PushSendFn = async (subscription, payload, vapid) => {
  const webpush = (await import("web-push")).default;
  const result = await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
    {
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
      // The push service holds it this long if the device is offline. A day is
      // right for this content: an expense from yesterday is still worth
      // knowing about; one from last week is noise.
      TTL: 86_400,
    },
  );
  return { statusCode: result.statusCode };
};

/**
 * Fan out one notification to a set of endpoints.
 *
 * Every send is settled independently: one dead endpoint (or one push service
 * having a bad day) must not stop the others, and nothing here is allowed to
 * throw - the caller is a write path that has already succeeded, and a failed
 * notification is not a failed expense.
 */
export async function deliverPush({
  kind,
  subscriptions,
  payload,
  vapid,
  repository,
  send = sendWithWebPush,
}: {
  /** What this fan-out was for, so the console can tell alerting from chatter. */
  kind: string;
  subscriptions: PushSubscriptionRecord[];
  payload: PushNotificationPayload;
  vapid: VapidKeys;
  repository: Pick<PushRepository, "pruneSubscription" | "logDelivery">;
  send?: PushSendFn;
}): Promise<PushDeliveryOutcome> {
  const outcome: PushDeliveryOutcome = { sent: 0, pruned: 0, failed: 0 };

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await send(subscription, payload, vapid);
        return "sent" as const;
      } catch (error) {
        const statusCode = statusCodeOf(error);

        if (statusCode !== null && isGone(statusCode)) {
          // Best-effort cleanup; a failed delete just means we try again next
          // time this endpoint comes up.
          await repository.pruneSubscription(subscription.endpoint).catch(() => {});
          return "pruned" as const;
        }

        console.error("[push] delivery failed:", statusCode ?? error);
        return "failed" as const;
      }
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      outcome.failed += 1;
      continue;
    }
    outcome[result.value] += 1;
  }

  // Recorded here rather than in each notify*: this is the one place every
  // notification passes through, so nothing can be added later that quietly
  // skips the bookkeeping. Swallowed for the same reason the sends are - the
  // write that triggered this already succeeded.
  await repository.logDelivery(kind, outcome).catch((error: unknown) => {
    console.warn("[push] delivery not recorded:", (error as Error).message);
  });

  return outcome;
}

/**
 * "Somebody added an entry" -> notifications for everyone else in the group.
 *
 * Called after the write has already committed, and swallows everything: the
 * expense is saved either way, and the caller must never turn a push problem
 * into a failed request.
 */
export async function notifyExpenseCreated({
  repository,
  vapid,
  groupId,
  actorUserId,
  expense,
  send,
}: {
  repository: PushRepository;
  vapid: VapidKeys;
  groupId: string;
  actorUserId: string;
  expense: { title: string; amount_minor: number; currency: string; kind: string };
  send?: PushSendFn;
}): Promise<PushDeliveryOutcome> {
  const empty: PushDeliveryOutcome = { sent: 0, pruned: 0, failed: 0 };

  try {
    const targets = await repository.targetsForGroup(groupId, actorUserId);

    if (targets.subscriptions.length === 0) {
      return empty;
    }

    const payload = buildExpenseNotification({
      groupId,
      groupName: targets.group_name,
      actorName: targets.actor_name,
      title: expense.title,
      amountMinor: expense.amount_minor,
      currency: expense.currency,
      kind: expense.kind,
    });

    return await deliverPush({ kind: "expense", subscriptions: targets.subscriptions, payload, vapid, repository, send });
  } catch (error) {
    console.error("[push] notify failed:", error);
    return empty;
  }
}

/**
 * "Somebody reminded you to settle up" -> that one member's devices.
 *
 * Swallowing failures matters more here than elsewhere: the nudge row is
 * already written and its cooldown has already started, so turning a push
 * problem into an error would tell the sender it failed while making them wait
 * six hours before they could try again.
 */
export async function notifyNudge({
  repository,
  vapid,
  groupId,
  toMemberId,
  groupName,
  fromName,
  balanceMinor,
  currency,
  send,
}: {
  repository: PushRepository;
  vapid: VapidKeys;
  groupId: string;
  toMemberId: string;
  groupName: string | null;
  fromName: string | null;
  balanceMinor: number;
  currency: string;
  send?: PushSendFn;
}): Promise<PushDeliveryOutcome> {
  const empty: PushDeliveryOutcome = { sent: 0, pruned: 0, failed: 0 };

  try {
    const targets = await repository.targetsForMember(groupId, toMemberId);

    if (targets.subscriptions.length === 0) {
      return empty;
    }

    const payload = buildNudgeNotification({
      groupId,
      // The group's name as the RPC knows it; the write's copy is only used
      // for the sender's own name.
      groupName: targets.group_name ?? groupName,
      fromName,
      balanceMinor,
      currency,
    });

    return await deliverPush({ kind: "nudge", subscriptions: targets.subscriptions, payload, vapid, repository, send });
  } catch (error) {
    console.error("[push] nudge notify failed:", error);
    return empty;
  }
}

/**
 * "Somebody joined" -> everyone in the group except the person who joined.
 *
 * The joiner is the actor, so targetsForGroup's existing exclusion is exactly
 * right: being told you have joined a group you just joined is noise.
 */
export async function notifyMemberJoined({
  repository,
  vapid,
  groupId,
  actorUserId,
  send,
}: {
  repository: PushRepository;
  vapid: VapidKeys;
  groupId: string;
  actorUserId: string;
  send?: PushSendFn;
}): Promise<PushDeliveryOutcome> {
  const empty: PushDeliveryOutcome = { sent: 0, pruned: 0, failed: 0 };

  try {
    const targets = await repository.targetsForGroup(groupId, actorUserId);

    if (targets.subscriptions.length === 0) {
      return empty;
    }

    const payload = buildMemberJoinedNotification({
      groupId,
      groupName: targets.group_name,
      // actor_name is the joiner's display name in this group - by the time
      // this runs the membership row exists, so the lookup resolves.
      memberName: targets.actor_name,
    });

    return await deliverPush({ kind: "member_joined", subscriptions: targets.subscriptions, payload, vapid, repository, send });
  } catch (error) {
    console.error("[push] join notify failed:", error);
    return empty;
  }
}

/**
 * "The app is throwing an error" -> the console's owners and admins.
 *
 * Called from the crash-report path, which is anonymous, rate-limited, and must
 * stay cheap — so like every other notify* here it swallows everything. The
 * error row is already written; failing to page somebody about it is not a
 * reason to turn a crash report into a 500 and lose the report as well.
 *
 * The decision of WHETHER to send is not made here: claim_error_alert made it
 * atomically in the database (per-fingerprint, cooldown, global hourly cap), so
 * this only fans out.
 */
export async function notifyErrorAlert({
  repository,
  vapid,
  fingerprint,
  message,
  occurrences,
  isNew,
  send,
}: {
  repository: Pick<PushRepository, "targetsForAdmins" | "pruneSubscription" | "logDelivery">;
  vapid: VapidKeys;
  fingerprint: string;
  message: string;
  occurrences: number;
  isNew: boolean;
  send?: PushSendFn;
}): Promise<PushDeliveryOutcome> {
  const empty: PushDeliveryOutcome = { sent: 0, pruned: 0, failed: 0 };

  try {
    const targets = await repository.targetsForAdmins();

    if (targets.subscriptions.length === 0) return empty;

    return await deliverPush({
      kind: "error_alert",
      subscriptions: targets.subscriptions,
      payload: buildErrorAlertNotification({ fingerprint, message, occurrences, isNew }),
      vapid,
      repository,
      send,
    });
  } catch (error) {
    console.error("[push] error alert failed:", error);
    return empty;
  }
}

/**
 * The automatic version of a nudge: same recipient, no sender.
 *
 * Its own kind in the delivery log so the console can tell reminders nobody
 * asked for apart from ones a person actually sent.
 */
export async function notifyAutoNudge({
  repository,
  vapid,
  groupId,
  toMemberId,
  groupName,
  balanceMinor,
  currency,
  send,
}: {
  repository: Pick<PushRepository, "targetsForMember" | "pruneSubscription" | "logDelivery">;
  vapid: VapidKeys;
  groupId: string;
  toMemberId: string;
  groupName: string | null;
  balanceMinor: number;
  currency: string;
  send?: PushSendFn;
}): Promise<PushDeliveryOutcome> {
  const empty: PushDeliveryOutcome = { sent: 0, pruned: 0, failed: 0 };

  try {
    const targets = await repository.targetsForMember(groupId, toMemberId);

    if (targets.subscriptions.length === 0) return empty;

    return await deliverPush({
      kind: "auto_nudge",
      subscriptions: targets.subscriptions,
      payload: buildAutoNudgeNotification({
        groupId,
        groupName: targets.group_name ?? groupName,
        balanceMinor,
        currency,
      }),
      vapid,
      repository,
      send,
    });
  } catch (error) {
    console.error("[push] auto nudge failed:", error);
    return empty;
  }
}
