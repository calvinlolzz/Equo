import { describe, expect, test, vi } from "vitest";
import type { NudgeRepository, NudgeResult } from "../repositories/nudgeRepository.js";
import { handleSendNudge, NUDGE_COOLDOWN_SECONDS } from "./nudge.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

const sent: NudgeResult = {
  status: "sent",
  group_name: "東京旅行",
  from_name: "Alice",
  to_user_id: "user_bob",
  to_name: "Bob",
  balance_minor: -32000,
  currency: "TWD",
};

function makeRepository(result: NudgeResult | null): NudgeRepository & { sendNudge: ReturnType<typeof vi.fn> } {
  return { sendNudge: vi.fn(async () => result) };
}

describe("handleSendNudge", () => {
  test("passes the cooldown to the write and reports what the notifier needs", async () => {
    const repository = makeRepository(sent);

    const result = await handleSendNudge(repository, context, "group_1", "member_bob");

    expect(repository.sendNudge).toHaveBeenCalledWith(
      "user_alice",
      "group_1",
      "member_bob",
      NUDGE_COOLDOWN_SECONDS,
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.ok && result.notify).toEqual({
      groupId: "group_1",
      toMemberId: "member_bob",
      groupName: "東京旅行",
      fromName: "Alice",
      balanceMinor: -32000,
      currency: "TWD",
    });
  });

  test("the recipient's user id never reaches the sender", async () => {
    const result = await handleSendNudge(makeRepository(sent), context, "group_1", "member_bob");

    expect(JSON.stringify(result.body)).not.toContain("user_bob");
    expect(result.body).toEqual({ nudge: { status: "sent" } });
  });

  test("a caller who is not in the group gets the same 403 as a missing group", async () => {
    const result = await handleSendNudge(makeRepository(null), context, "group_1", "member_bob");

    expect(result.status).toBe(403);
    expect(result.ok === false && result.body.error.code).toBe("FORBIDDEN");
  });

  test("each refusal keeps its own code so the UI can explain itself", async () => {
    const cooldown = await handleSendNudge(
      makeRepository({ status: "cooldown", retry_after_seconds: 900 }),
      context,
      "group_1",
      "member_bob",
    );
    expect(cooldown.status).toBe(409);
    expect(cooldown.ok === false && cooldown.body.error.code).toBe("NUDGE_COOLDOWN");
    expect(cooldown.ok === false && cooldown.body.error.message).toContain("900");

    const settled = await handleSendNudge(makeRepository({ status: "settled" }), context, "group_1", "member_bob");
    expect(settled.status).toBe(409);
    expect(settled.ok === false && settled.body.error.code).toBe("NUDGE_NOT_NEEDED");

    const missing = await handleSendNudge(
      makeRepository({ status: "member_not_found" }),
      context,
      "group_1",
      "member_ghost",
    );
    expect(missing.status).toBe(404);
    expect(missing.ok === false && missing.body.error.code).toBe("MEMBER_NOT_FOUND");

    const invalid = await handleSendNudge(
      makeRepository({ status: "invalid_target" }),
      context,
      "group_1",
      "member_virtual",
    );
    expect(invalid.status).toBe(400);
    expect(invalid.ok === false && invalid.body.error.code).toBe("INVALID_MEMBER");
  });

  test("nothing is handed to the notifier on a refusal", async () => {
    const result = await handleSendNudge(
      makeRepository({ status: "cooldown", retry_after_seconds: 60 }),
      context,
      "group_1",
      "member_bob",
    );

    expect("notify" in result).toBe(false);
  });

  test("the cooldown is long enough to be felt", () => {
    // A "reminder" you can send every few minutes is a harassment tool. The
    // exact number is a product decision; that it is hours, not minutes, is
    // the part worth defending in a test.
    expect(NUDGE_COOLDOWN_SECONDS).toBeGreaterThanOrEqual(60 * 60);
  });
});
