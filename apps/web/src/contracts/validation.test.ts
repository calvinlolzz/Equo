import { describe, expect, test } from "vitest";
import type { CreateExpenseRequest, UploadGroupImageRequest } from "./schemas.js";
import {
  validateSetMemberPaymentNoteRequest,
  decodedBase64Size,
  imageExtensionFromDataUrl,
  validateCreateExpenseRequest,
  validateCreateVirtualMemberRequest,
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
  // The routes reach the body through an unchecked cast, so the static type is a
  // claim about the request, not a fact. Reading a field off a body that doesn't
  // have it threw a TypeError, which the runtime's catch-all turned into a 500 -
  // so a malformed body, which is a plain 400, looked like a server fault.
  test.each([
    ["an empty object", {}],
    ["null", null],
    ["an array", []],
    ["a string", "not an object"],
    ["a body with no client_request_id", { amount_minor: 100, expense_payments: [], expense_shares: [] }],
    ["a body with no amount_minor", { client_request_id: "r", expense_payments: [], expense_shares: [] }],
    ["expense_payments that is not an array", { client_request_id: "r", amount_minor: 100, expense_payments: "x", expense_shares: [] }],
    ["expense_shares that is not an array", { client_request_id: "r", amount_minor: 100, expense_payments: [], expense_shares: 7 }],
    ["expense_payments holding a non-object", { client_request_id: "r", amount_minor: 100, expense_payments: ["x"], expense_shares: [] }],
  ])("reports %s as MALFORMED_REQUEST rather than throwing", (_label, body) => {
    const result = validateCreateExpenseRequest(body);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["MALFORMED_REQUEST"]);
  });

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

describe("validateCreateVirtualMemberRequest", () => {
  test("accepts a non-empty display name with a client_request_id", () => {
    const result = validateCreateVirtualMemberRequest({
      client_request_id: "req_add_member",
      display_name: "測試阿華",
    });

    expect(result).toEqual({ ok: true, issues: [] });
  });

  test("rejects a missing display_name before it can reach the database", () => {
    // The malformed request the review report reproduced: no display_name,
    // which previously slipped through to a half-written null-name member.
    const result = validateCreateVirtualMemberRequest({
      client_request_id: "req_add_member",
    } as Parameters<typeof validateCreateVirtualMemberRequest>[0]);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_MEMBER");
  });

  test("rejects a whitespace-only display name and a missing client_request_id", () => {
    const blankName = validateCreateVirtualMemberRequest({ client_request_id: "req", display_name: "   " });
    const noRequestId = validateCreateVirtualMemberRequest({ client_request_id: "", display_name: "阿華" });

    expect(blankName.ok).toBe(false);
    expect(blankName.issues.map((issue) => issue.code)).toContain("INVALID_MEMBER");
    expect(noRequestId.ok).toBe(false);
    expect(noRequestId.issues.map((issue) => issue.code)).toContain("IDEMPOTENCY_CONFLICT");
  });

  test("rejects a display name over 50 characters", () => {
    const result = validateCreateVirtualMemberRequest({
      client_request_id: "req",
      display_name: "x".repeat(51),
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_MEMBER");
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

describe("validateSetMemberPaymentNoteRequest", () => {
  test("accepts a note within the column's limit", () => {
    expect(validateSetMemberPaymentNoteRequest({ payment_note: "玉山 808 末五碼 12345" }).ok).toBe(true);
  });

  test("accepts an empty string, which is how the note is cleared", () => {
    expect(validateSetMemberPaymentNoteRequest({ payment_note: "" }).ok).toBe(true);
  });

  test("rejects an absent field rather than treating it as a clear", () => {
    // A client that forgets the field must not silently wipe somebody's
    // account details.
    expect(validateSetMemberPaymentNoteRequest({} as never).ok).toBe(false);
  });

  test("rejects a note past the length the CHECK constraint allows", () => {
    // Matching the constraint here is what turns this into a 400 the UI can
    // explain instead of a 500 out of Postgres.
    expect(validateSetMemberPaymentNoteRequest({ payment_note: "x".repeat(201) }).ok).toBe(false);
    expect(validateSetMemberPaymentNoteRequest({ payment_note: "x".repeat(200) }).ok).toBe(true);
  });
});
