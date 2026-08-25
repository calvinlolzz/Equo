import { describe, expect, test } from "vitest";
import type {
  CreateFeedbackInput,
  ErrorAlertClaim,
  ReportErrorInput,
  SupportRepository,
} from "../repositories/supportRepository.js";
import { FEEDBACK_MESSAGE_MAX, handleCreateFeedback, handleReportError } from "./support.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

function makeRepository(claim: Partial<ErrorAlertClaim> & { throws?: boolean } = {}) {
  const feedbackCalls: Array<{ userId: string; input: CreateFeedbackInput }> = [];
  const errorCalls: Array<{ userId: string | null; input: ReportErrorInput }> = [];
  const claimCalls: Array<{ source: string; message: string }> = [];

  const repository: SupportRepository = {
    async createFeedback(userId, input) {
      feedbackCalls.push({ userId, input });
      return { id: "feedback_1" };
    },
    async recordClientError(userId, input) {
      errorCalls.push({ userId, input });
    },
    async claimErrorAlert(source, message) {
      claimCalls.push({ source, message });
      if (claim.throws) throw new Error("function does not exist");
      return { alert: false, reason: "cooldown", ...claim };
    },
  };

  return { repository, feedbackCalls, errorCalls, claimCalls };
}

describe("handleCreateFeedback", () => {
  test("stores trimmed feedback with the caller's user id", async () => {
    const { repository, feedbackCalls } = makeRepository();

    const result = await handleCreateFeedback(repository, context, {
      type: "suggestion",
      message: "  想要多幣別統計  ",
      page: "/group/abc",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ feedback: { id: "feedback_1" } });
    expect(feedbackCalls[0]).toEqual({
      userId: "user_alice",
      input: { type: "suggestion", message: "想要多幣別統計", contact: null, page: "/group/abc" },
    });
  });

  test("rejects empty messages with 400 INVALID_FEEDBACK", async () => {
    const { repository, feedbackCalls } = makeRepository();

    const result = await handleCreateFeedback(repository, context, { message: "   " });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe("INVALID_FEEDBACK");
    expect(feedbackCalls).toHaveLength(0);
  });

  test("normalizes unknown types to other and clamps long messages", async () => {
    const { repository, feedbackCalls } = makeRepository();

    await handleCreateFeedback(repository, context, {
      type: "rant",
      message: "很".repeat(FEEDBACK_MESSAGE_MAX + 100),
    });

    expect(feedbackCalls[0].input.type).toBe("other");
    expect(feedbackCalls[0].input.message).toHaveLength(FEEDBACK_MESSAGE_MAX);
  });
});

describe("handleReportError", () => {
  test("records a clamped error row with the resolved user id", async () => {
    const { repository, errorCalls } = makeRepository();

    const result = await handleReportError(repository, "user_alice", {
      source: "web",
      message: "TypeError: x is undefined",
      context: "stack trace",
      page: "/group/abc",
    });

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ ok: true });
    expect(errorCalls[0]).toEqual({
      userId: "user_alice",
      input: { source: "web", message: "TypeError: x is undefined", context: "stack trace", page: "/group/abc" },
    });
  });

  test("accepts anonymous reports and normalizes unknown sources to web", async () => {
    const { repository, errorCalls } = makeRepository();

    await handleReportError(repository, null, { source: "martian", message: "boom" });

    expect(errorCalls[0].userId).toBeNull();
    expect(errorCalls[0].input.source).toBe("web");
  });

  test("silently drops empty messages but still answers ok", async () => {
    const { repository, errorCalls } = makeRepository();

    const result = await handleReportError(repository, null, { message: "  " });

    expect(result.ok).toBe(true);
    expect(errorCalls).toHaveLength(0);
  });
});

describe("handleReportError alerting", () => {
  test("asks whether this crash is worth an alert, using the stored message", async () => {
    const { repository, claimCalls } = makeRepository();

    await handleReportError(repository, null, { source: "web", message: "  TypeError: x  " });

    // The clamped/trimmed message, so the fingerprint matches the row that was
    // just written rather than the raw body.
    expect(claimCalls).toEqual([{ source: "web", message: "TypeError: x" }]);
  });

  test("hands the runtime what it needs when the claim says send", async () => {
    const { repository } = makeRepository({
      alert: true,
      reason: "new",
      fingerprint: "fp_1",
      occurrences_24h: 12,
    });

    const result = await handleReportError(repository, null, { source: "web", message: "boom" });

    expect(result.alert).toEqual({ fingerprint: "fp_1", message: "boom", occurrences: 12, isNew: true });
  });

  test("a recurrence is not flagged as new", async () => {
    const { repository } = makeRepository({ alert: true, reason: "recurring", fingerprint: "fp_1" });

    const result = await handleReportError(repository, null, { source: "web", message: "boom" });

    expect(result.alert?.isNew).toBe(false);
  });

  test("says nothing to the runtime when the claim refuses", async () => {
    const { repository } = makeRepository({ alert: false, reason: "hourly_cap" });

    const result = await handleReportError(repository, null, { source: "web", message: "boom" });

    expect(result.alert).toBeUndefined();
    expect(result.status).toBe(200);
  });

  test("a missing claim function costs the alert, never the error row", async () => {
    // A deployment running ahead of the migration. Losing the crash report
    // would be much worse than losing the page about it.
    const { repository, errorCalls } = makeRepository({ throws: true });

    const result = await handleReportError(repository, null, { source: "web", message: "boom" });

    expect(result.status).toBe(200);
    expect(result.alert).toBeUndefined();
    expect(errorCalls).toHaveLength(1);
  });

  test("an empty report is not claimed at all", async () => {
    const { repository, claimCalls, errorCalls } = makeRepository();

    await handleReportError(repository, null, { source: "web", message: "   " });

    expect(errorCalls).toEqual([]);
    expect(claimCalls).toEqual([]);
  });
});
