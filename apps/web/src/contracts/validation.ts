import type { ErrorCode } from "./errors.js";
import type {
  CreateExpenseRequest,
  CreateVirtualMemberRequest,
  RenameGroupMemberRequest,
  UpdateMyAvatarRequest,
  UploadGroupImageRequest,
} from "./schemas.js";

export type ValidationIssue = {
  code: ErrorCode;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

function issue(code: ErrorCode, message: string): ValidationIssue {
  return { code, message };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function malformed(message: string): ValidationResult {
  return { ok: false, issues: [issue("MALFORMED_REQUEST", message)] };
}

/**
 * The input is whatever JSON the caller sent. The routes reach it through
 * `body<CreateExpenseRequest>(request)`, which is an unchecked cast, not a
 * parse - so the static type is a claim about the request, not a fact about it.
 *
 * Take it as `unknown` and check the shape before touching a field. Reading
 * `request.client_request_id.trim()` off a `{}` throws a TypeError, and the
 * runtime's catch-all turns that into a 500 - so a malformed body, which is a
 * plain 400, came back looking like a server fault instead. POST and PUT
 * /groups/:id/expenses both did exactly that.
 */
export function validateCreateExpenseRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return malformed("request body must be a JSON object");
  }

  const candidate = input as Partial<CreateExpenseRequest>;

  if (typeof candidate.client_request_id !== "string") {
    return malformed("client_request_id is required");
  }

  if (typeof candidate.amount_minor !== "number") {
    return malformed("amount_minor is required");
  }

  if (!Array.isArray(candidate.expense_payments)) {
    return malformed("expense_payments is required");
  }

  if (!Array.isArray(candidate.expense_shares)) {
    return malformed("expense_shares is required");
  }

  if (candidate.expense_payments.some((payment) => !payment || typeof payment !== "object")) {
    return malformed("expense_payments must contain objects");
  }

  if (candidate.expense_shares.some((share) => !share || typeof share !== "object")) {
    return malformed("expense_shares must contain objects");
  }

  const request = candidate as CreateExpenseRequest;
  const issues: ValidationIssue[] = [];

  if (!request.client_request_id.trim()) {
    issues.push(issue("IDEMPOTENCY_CONFLICT", "client_request_id is required"));
  }

  if (!isPositiveInteger(request.amount_minor)) {
    issues.push(issue("INVALID_AMOUNT", "amount_minor must be a positive integer"));
  }

  if (request.expense_payments.length === 0) {
    issues.push(issue("PAYMENT_TOTAL_MISMATCH", "expense_payments must include at least one payer"));
  }

  if (request.expense_shares.length === 0 && request.kind !== "transfer") {
    issues.push(issue("EXPENSE_SHARE_TOTAL_MISMATCH", "expense_shares must include at least one member"));
  }

  if (request.kind === "transfer" && !request.transfer_to_member_id?.trim()) {
    issues.push(issue("MEMBER_NOT_FOUND", "transfer_to_member_id is required for transfer"));
  }

  const paymentTotal = sum(request.expense_payments.map((payment) => payment.amount_minor));
  if (paymentTotal !== request.amount_minor) {
    issues.push(issue("PAYMENT_TOTAL_MISMATCH", "expense_payments total must equal amount_minor"));
  }

  const shareTotal = sum(request.expense_shares.map((share) => share.amount_minor));
  if (request.kind !== "transfer" && shareTotal !== request.amount_minor) {
    issues.push(issue("EXPENSE_SHARE_TOTAL_MISMATCH", "expense_shares total must equal amount_minor"));
  }

  for (const payment of request.expense_payments) {
    if (payment.currency !== request.currency) {
      issues.push(issue("PAYMENT_TOTAL_MISMATCH", "expense_payments currency must match expense currency"));
    }

    if (!isPositiveInteger(payment.amount_minor)) {
      issues.push(issue("INVALID_AMOUNT", "expense_payments amount_minor must be a positive integer"));
    }
  }

  for (const share of request.expense_shares) {
    if (!Number.isInteger(share.amount_minor) || share.amount_minor < 0) {
      issues.push(issue("INVALID_AMOUNT", "expense_shares amount_minor must be a non-negative integer"));
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

/**
 * group_members.display_name is text with no schema cap, so an explicit
 * length ceiling here stops a create/rename from smuggling in an absurdly
 * long name. 50 chars matches what the UI's name field allows.
 */
const MAX_MEMBER_DISPLAY_NAME_LENGTH = 50;

/**
 * Shared entry-validation for the two endpoints that write a member's
 * display_name (create virtual member, rename member). Both require a
 * client_request_id (idempotency key) and a non-empty, bounded display name.
 * Enforcing this at the route boundary is what keeps a malformed request
 * from reaching the database at all - the alternative was a half-written
 * "ghost" member row when a later write in the same handler threw (see
 * createVirtualMemberRoute).
 */
function validateMemberDisplayName(request: {
  client_request_id?: string;
  display_name?: string;
}): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!request.client_request_id?.trim()) {
    issues.push(issue("IDEMPOTENCY_CONFLICT", "client_request_id is required"));
  }

  const displayName = request.display_name?.trim() ?? "";

  if (!displayName) {
    issues.push(issue("INVALID_MEMBER", "display_name is required"));
  } else if (displayName.length > MAX_MEMBER_DISPLAY_NAME_LENGTH) {
    issues.push(
      issue("INVALID_MEMBER", `display_name must be ${MAX_MEMBER_DISPLAY_NAME_LENGTH} characters or fewer`),
    );
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateCreateVirtualMemberRequest(request: CreateVirtualMemberRequest): ValidationResult {
  return validateMemberDisplayName(request);
}

export function validateRenameGroupMemberRequest(request: RenameGroupMemberRequest): ValidationResult {
  return validateMemberDisplayName(request);
}

const DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

export function decodedBase64Size(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function validateUploadGroupImageRequest(request: UploadGroupImageRequest): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!request.client_request_id?.trim()) {
    issues.push(issue("IDEMPOTENCY_CONFLICT", "client_request_id is required"));
  }

  if (request.kind !== "expense" && request.kind !== "cover") {
    issues.push(issue("INVALID_IMAGE", "kind must be 'expense' or 'cover'"));
  }

  const match = DATA_URL_PATTERN.exec(request.data_url ?? "");

  if (!match) {
    issues.push(issue("INVALID_IMAGE", "data_url must be a base64 jpeg, png, or webp data URL"));
  } else if (decodedBase64Size(match[2]) > MAX_IMAGE_BYTES) {
    issues.push(issue("INVALID_IMAGE", "data_url must decode to 1.5 MB or less"));
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

/**
 * Same data:image type/size rules as validateUploadGroupImageRequest (this
 * is a self-scoped avatar upload, not a group image, so there's no "kind"
 * field to check).
 */
export function validateUpdateMyAvatarRequest(request: UpdateMyAvatarRequest): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!request.client_request_id?.trim()) {
    issues.push(issue("IDEMPOTENCY_CONFLICT", "client_request_id is required"));
  }

  const match = DATA_URL_PATTERN.exec(request.data_url ?? "");

  if (!match) {
    issues.push(issue("INVALID_IMAGE", "data_url must be a base64 jpeg, png, or webp data URL"));
  } else if (decodedBase64Size(match[2]) > MAX_IMAGE_BYTES) {
    issues.push(issue("INVALID_IMAGE", "data_url must decode to 1.5 MB or less"));
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function imageExtensionFromDataUrl(dataUrl: string): string | null {
  const match = DATA_URL_PATTERN.exec(dataUrl);

  if (!match) {
    return null;
  }

  return match[1] === "jpeg" ? "jpg" : match[1];
}
