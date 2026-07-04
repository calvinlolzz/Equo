import { describe, expect, test } from "vitest";
import type { CreateExpenseRequest, UploadGroupImageRequest } from "./schemas.js";
import {
  decodedBase64Size,
  imageExtensionFromDataUrl,
  validateCreateExpenseRequest,
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
