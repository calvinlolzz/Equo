import type { PostgrestClient } from "../db/postgrestClient.js";
import { createSupabasePushRepository } from "../repositories/supabasePushRepository.js";
import { notifyAutoNudge, type PushSendFn, type VapidKeys } from "../push/pushSender.js";

/** One overdue debtor, as claim_due_nudges hands them over. */
type DueNudge = {
  group_id: string;
  group_name: string | null;
  member_id: string;
  user_id: string;
  balance_minor: number;
  currency: string;
};

type AutoNudgeSettings = {
  enabled: boolean;
  overdue_days: number;
  cooldown_days: number;
};

type RunOptions = {
  client: PostgrestClient;
  vapid?: VapidKeys;
  pushSend?: PushSendFn;
};

/**
 * The scheduled 自動催繳 run.
 *
 * Called by a scheduler, not a user, so there is no session here — the caller
 * is authenticated by a shared secret at the route layer before this runs.
 *
 * Three gates before anything is sent, in order of how cheap they are to check:
 *   1. The console's switch. Off by default; this is the only thing in the
 *      product that messages somebody without a person deciding to.
 *   2. VAPID configured. Without it there is no transport, and claiming the
 *      nudges anyway would burn everyone's cooldown sending nothing.
 *   3. claim_due_nudges, which decides and records atomically so a retried run
 *      cannot send twice.
 *
 * Returns counts rather than throwing: the scheduler's job is to invoke this,
 * not to interpret it, and a partial failure is visible in the heartbeat.
 */
export async function runAutoNudges(options: RunOptions) {
  const settings = await options.client.rpc<AutoNudgeSettings>("auto_nudge_settings", {});

  if (!settings?.enabled) {
    return { ok: true as const, status: 200 as const, body: { status: "disabled", claimed: 0, sent: 0 } };
  }

  if (!options.vapid) {
    // Deliberately BEFORE the claim. Claiming would mark every one of these
    // people as reminded and start their cooldown, so a missing key would
    // silently consume a week of reminders and deliver none of them.
    return { ok: true as const, status: 200 as const, body: { status: "push_unconfigured", claimed: 0, sent: 0 } };
  }

  const due = (await options.client.rpc<DueNudge[] | null>("claim_due_nudges", {
    p_overdue_days: settings.overdue_days,
    p_cooldown_days: settings.cooldown_days,
  })) ?? [];

  const repository = createSupabasePushRepository(options.client);
  let sent = 0;

  // Sequential on purpose: this runs once a day against a handful of people,
  // and a burst of parallel web-push calls is the kind of thing a push service
  // rate-limits.
  for (const nudge of due) {
    const outcome = await notifyAutoNudge({
      repository,
      vapid: options.vapid,
      groupId: nudge.group_id,
      toMemberId: nudge.member_id,
      groupName: nudge.group_name,
      balanceMinor: nudge.balance_minor,
      currency: nudge.currency,
      send: options.pushSend,
    });
    sent += outcome.sent;
  }

  // Same heartbeat treatment as the nightly jobs, so "the reminders stopped
  // running" is visible on the health card instead of being silence.
  await options.client
    .rpc<null>("record_ops_heartbeat", {
      p_kind: "auto_nudge",
      p_detail: { claimed: due.length, sent },
    })
    .catch((error: unknown) => {
      console.warn("[auto-nudge] heartbeat not recorded:", (error as Error).message);
    });

  return { ok: true as const, status: 200 as const, body: { status: "ran", claimed: due.length, sent } };
}
