import { describe, expect, test } from "vitest";
import { describePushState, detectPushSubscriptionState, type PushState } from "./pushNotifications";

const enabledKey = async () => ({ enabled: true, public_key: "BEYD" });

describe("detectPushSubscriptionState", () => {
  test("a browser without the APIs is unsupported, and never asks the server", async () => {
    let asked = false;

    const state = await detectPushSubscriptionState({
      support: "unsupported",
      fetchPublicKey: async () => {
        asked = true;
        return { enabled: true, public_key: "x" };
      },
    });

    expect(state).toBe("unsupported");
    expect(asked).toBe(false);
  });

  test("an iPhone that has not installed the app gets its own, fixable answer", async () => {
    const state = await detectPushSubscriptionState({
      support: "needs-install",
      fetchPublicKey: enabledKey,
    });

    expect(state).toBe("needs-install");
  });

  test("a deployment with no VAPID key reports unavailable, not off", async () => {
    // "off" would offer a switch that silently delivers nothing.
    const state = await detectPushSubscriptionState({
      support: "supported",
      permission: "granted",
      fetchPublicKey: async () => ({ enabled: false }),
    });

    expect(state).toBe("unavailable");
  });

  test("a blocked permission is distinct from simply being off", async () => {
    const state = await detectPushSubscriptionState({
      support: "supported",
      permission: "denied",
      fetchPublicKey: enabledKey,
    });

    expect(state).toBe("denied");
  });

  test("never asked yet reads as off", async () => {
    const state = await detectPushSubscriptionState({
      support: "supported",
      permission: "default",
      fetchPublicKey: enabledKey,
      getSubscription: async () => ({}) as PushSubscription,
    });

    expect(state).toBe("off");
  });

  test("granted plus a live subscription is on", async () => {
    const state = await detectPushSubscriptionState({
      support: "supported",
      permission: "granted",
      fetchPublicKey: enabledKey,
      getSubscription: async () => ({}) as PushSubscription,
    });

    expect(state).toBe("on");
  });

  test("granted but no subscription is off, not on", async () => {
    // Clearing site data drops the subscription while the permission survives;
    // reporting "on" there would leave a switch that lies.
    const state = await detectPushSubscriptionState({
      support: "supported",
      permission: "granted",
      fetchPublicKey: enabledKey,
      getSubscription: async () => null,
    });

    expect(state).toBe("off");
  });
});

describe("describePushState", () => {
  test("every state says something a user can act on", () => {
    const states: PushState[] = ["loading", "unsupported", "needs-install", "unavailable", "denied", "off", "on"];

    for (const state of states) {
      expect(describePushState(state).length).toBeGreaterThan(0);
    }
  });

  test("the blocked and iPhone cases explain what to do about it", () => {
    expect(describePushState("denied")).toContain("設定");
    expect(describePushState("needs-install")).toContain("主畫面");
  });
});
