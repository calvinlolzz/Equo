import type { PushRepository, PushSubscriptionRecord } from "../repositories/pushRepository.js";
import { buildExpenseNotification, type PushNotificationPayload } from "./pushNotification.js";

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
  subscriptions,
  payload,
  vapid,
  repository,
  send = sendWithWebPush,
}: {
  subscriptions: PushSubscriptionRecord[];
  payload: PushNotificationPayload;
  vapid: VapidKeys;
  repository: Pick<PushRepository, "pruneSubscription">;
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

    return await deliverPush({ subscriptions: targets.subscriptions, payload, vapid, repository, send });
  } catch (error) {
    console.error("[push] notify failed:", error);
    return empty;
  }
}
