import type { ErrorCode } from "./errors.js";
import type { CreateExpenseRequest } from "./schemas.js";

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

export function validateCreateExpenseRequest(request: CreateExpenseRequest): ValidationResult {
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
