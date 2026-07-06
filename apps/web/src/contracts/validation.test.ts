import { describe, expect, test } from "vitest";
import type { CreateExpenseRequest, UploadGroupImageRequest } from "./schemas.js";
import {
  decodedBase64Size,
  imageExtensionFromDataUrl,
  validateCreateExpenseRequest,
  validateRenameGroupMemberRequest,
  validateUploadGroupImageRequest,
} from "./validation.js";

const balancedExpense: CreateExpenseRequest = {
  client_request_id: "req_001",
  title: "??",
  kind: "expense",
  category: "food",
  amount_minor: 1200,
  currency: "TWD",
  expense_date: "2026-06-30",
  expense_payments: [
    { payer_member_id: "alice", amount_minor: 1200, currency: "TWD" },
  ],
  expense_shares: [
    { member_id: "alice", share_type: "fixed", amount_minor: 600 },
    { member_id: "bob", share_type: "fixed", amount_minor: 600 },
  ],
};

describe("validateCreateExpenseRequest", () => {
  test("rejects an expense when payments do not match amount", () => {
    const result = validateCreateExpenseRequest({
      ...balancedExpense,
      expense_payments: [
        { payer_member_id: "alice", amount_minor: 1100, currency: "TWD" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("PAYMENT_TOTAL_MISMATCH");
  });

  test("rejects an expense when shares do not match amount", () => {
    const result = validateCreateExpenseRequest({
      ...balancedExpense,
      expense_shares: [
        { member_id: "alice", share_type: "fixed", amount_minor: 400 },
        { member_id: "bob", share_type: "fixed", amount_minor: 400 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("EXPENSE_SHARE_TOTAL_MISMATCH");
  });

  test("accepts a balanced expense request", () => {
    const result = validateCreateExpenseRequest(balancedExpense);

    expect(result).toEqual({ ok: true, issues: [] });
  });
});

describe("validateRenameGroupMemberRequest", () => {
  test("accepts a trimmed non-empty display name", () => {
    const result = validateRenameGroupMemberRequest({
      client_request_id: "req_rename",
      display_name: "Bobby",
    });

    expect(result).toEqual({ ok: true, issues: [] });
  });

  test("rejects a missing client_request_id", () => {
    const result = validateRenameGroupMemberRequest({
      client_request_id: " ",
      display_name: "Bobby",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("IDEMPOTENCY_CONFLICT");
  });

  test("rejects an empty or whitespace-only display name", () => {
    const empty = validateRenameGroupMemberRequest({ client_request_id: "req_rename", display_name: "" });
    const blank = validateRenameGroupMemberRequest({ client_request_id: "req_rename", display_name: "   " });

    expect(empty.ok).toBe(false);
    expect(empty.issues.map((issue) => issue.code)).toContain("INVALID_MEMBER");
    expect(blank.ok).toBe(false);
    expect(blank.issues.map((issue) => issue.code)).toContain("INVALID_MEMBER");
  });

  test("rejects a display name over 50 characters, counting the trimmed length", () => {
    const tooLong = validateRenameGroupMemberRequest({
      client_request_id: "req_rename",
      display_name: "x".repeat(51),
    });
    const paddedButOk = validateRenameGroupMemberRequest({
      client_request_id: "req_rename",
      display_name: `  ${"x".repeat(50)}  `,
    });

    expect(tooLong.ok).toBe(false);
    expect(tooLong.issues.map((issue) => issue.code)).toContain("INVALID_MEMBER");
    expect(paddedButOk).toEqual({ ok: true, issues: [] });
  });
});

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const validImageUpload: UploadGroupImageRequest = {
  client_request_id: "req_image",
  kind: "expense",
  data_url: `data:image/png;base64,${tinyPngBase64}`,
};

describe("validateUploadGroupImageRequest", () => {
  test("accepts a small base64 png data URL", () => {
    const result = validateUploadGroupImageRequest(validImageUpload);

    expect(result).toEqual({ ok: true, issues: [] });
  });

  test("rejects a data URL with an unsupported mime type", () => {
    const result = validateUploadGroupImageRequest({
      ...validImageUpload,
      data_url: "data:text/plain;base64,aGVsbG8=",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_IMAGE");
  });

  test("rejects a non-data-URL string", () => {
    const result = validateUploadGroupImageRequest({
      ...validImageUpload,
      data_url: "https://example.com/photo.jpg",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_IMAGE");
  });

  test("rejects a data URL that decodes to more than 1.5 MB", () => {
    const oversizedBase64 = "A".repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3));

    const result = validateUploadGroupImageRequest({
      ...validImageUpload,
      data_url: `data:image/jpeg;base64,${oversizedBase64}`,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_IMAGE");
  });

  test("rejects a missing client_request_id", () => {
    const result = validateUploadGroupImageRequest({ ...validImageUpload, client_request_id: "" });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("IDEMPOTENCY_CONFLICT");
  });
});

describe("decodedBase64Size", () => {
  test("computes the decoded byte length accounting for padding", () => {
    expect(decodedBase64Size("aGVsbG8=")).toBe(5); // "hello"
    expect(decodedBase64Size("aGVsbG8h")).toBe(6); // "hello!" (no padding)
  });
});

describe("imageExtensionFromDataUrl", () => {
  test("maps jpeg to a jpg extension", () => {
    expect(imageExtensionFromDataUrl(`data:image/jpeg;base64,${tinyPngBase64}`)).toBe("jpg");
  });

  test("keeps png and webp extensions as-is", () => {
    expect(imageExtensionFromDataUrl(`data:image/png;base64,${tinyPngBase64}`)).toBe("png");
    expect(imageExtensionFromDataUrl(`data:image/webp;base64,${tinyPngBase64}`)).toBe("webp");
  });

  test("returns null for a non-matching data URL", () => {
    expect(imageExtensionFromDataUrl("data:text/plain;base64,aGVsbG8=")).toBeNull();
  });
});
