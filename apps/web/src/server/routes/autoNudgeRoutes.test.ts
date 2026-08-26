import { describe, expect, test, vi } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { buildAutoNudgeNotification } from "../push/pushNotification.js";
import { runAutoNudges } from "./autoNudgeRoutes.js";

const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@equo.local" };

const dueNudge = {
  group_id: "group_1",
  group_name: "室友",
  member_id: "member_1",
  user_id: "user_1",
  balance_minor: -120_000,
  currency: "TWD",
};

type Settings = { enabled: boolean; overdue_days?: number; cooldown_days?: number };

function makeClient(settings: Settings, due: unknown[] = [dueNudge]) {
  return createFakePostgrest({
    rpc: (fn) => {
      if (fn === "auto_nudge_settings") return { overdue_days: 14, cooldown_days: 7, ...settings };
      if (fn === "claim_due_nudges") return due;
      if (fn === "push_targets_for_member") {
        return {
          group_name: "室友",
          actor_name: null,
          subscriptions: [{ endpoint: "https://push.example/1", p256dh: "k", auth: "a" }],
        };
      }
      if (fn === "record_ops_heartbeat") return { kind: "auto_nudge" };
      if (fn === "log_push_delivery") return null;
      throw new Error(`Unexpected rpc ${fn}`);
    },
  });
}

describe("runAutoNudges", () => {
  test("sends nothing while the console switch is off", async () => {
    const client = makeClient({ enabled: false });
    const send = vi.fn(async () => ({ statusCode: 201 }));

    const result = await runAutoNudges({ client, vapid, pushSend: send });

    expect(result.body).toMatchObject({ status: "disabled", claimed: 0, sent: 0 });
    // The switch has to stop it BEFORE anything is claimed, or being "off"
    // would still burn everybody's cooldown.
    expect(client.rpcCall("claim_due_nudges")).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  test("does not claim anybody when push is unconfigured", async () => {
    // THE case worth pinning: claiming marks every one of these people as
    // reminded and starts their cooldown. Doing that with no transport would
    // silently eat a week of reminders and deliver none of them.
    const client = makeClient({ enabled: true });

    const result = await runAutoNudges({ client });

    expect(result.body).toMatchObject({ status: "push_unconfigured", claimed: 0 });
    expect(client.rpcCall("claim_due_nudges")).toBeUndefined();
  });

  test("claims with the configured windows and pushes each one", async () => {
    const client = makeClient({ enabled: true, overdue_days: 30, cooldown_days: 10 });
    const send = vi.fn(async () => ({ statusCode: 201 }));

    const result = await runAutoNudges({ client, vapid, pushSend: send });

    expect(client.rpcCall("claim_due_nudges")?.args).toMatchObject({
      p_overdue_days: 30,
      p_cooldown_days: 10,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({ status: "ran", claimed: 1, sent: 1 });
  });

  test("records a heartbeat so a run that stops running is visible", async () => {
    const client = makeClient({ enabled: true });

    await runAutoNudges({ client, vapid, pushSend: vi.fn(async () => ({ statusCode: 201 })) });

    expect(client.rpcCall("record_ops_heartbeat")?.args).toMatchObject({
      p_kind: "auto_nudge",
      p_detail: { claimed: 1, sent: 1 },
    });
  });

  test("nobody due is a normal run, not an error", async () => {
    const client = makeClient({ enabled: true }, []);

    const result = await runAutoNudges({ client, vapid, pushSend: vi.fn(async () => ({ statusCode: 201 })) });

    expect(result.body).toMatchObject({ status: "ran", claimed: 0, sent: 0 });
  });
});

describe("buildAutoNudgeNotification", () => {
  test("names no sender, because nobody sent it", () => {
    // buildNudgeNotification falls back to 有人; "有人提醒你" would be a lie
    // here - the app noticed, not a person.
    const payload = buildAutoNudgeNotification({
      groupId: "group_1",
      groupName: "室友",
      balanceMinor: -120_000,
      currency: "TWD",
    });

    expect(payload.title).toBe("室友");
    expect(payload.body).toBe("你還有 $1,200 未結清");
    expect(payload.body).not.toContain("有人");
  });

  test("states the debt as a positive amount", () => {
    const payload = buildAutoNudgeNotification({
      groupId: "group_1",
      groupName: "室友",
      balanceMinor: -50_000,
      currency: "TWD",
    });

    expect(payload.body).not.toContain("-");
  });

  test("shares the manual nudge's tag, so two reminders replace rather than stack", () => {
    expect(
      buildAutoNudgeNotification({ groupId: "group_1", groupName: "x", balanceMinor: -1, currency: "TWD" }).tag,
    ).toBe("nudge-group_1");
  });
});
