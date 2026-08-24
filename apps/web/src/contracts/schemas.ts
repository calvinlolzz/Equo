import type { CurrencyCode } from "../domain/money.js";

export type IdempotentRequest = {
  client_request_id: string;
};

export type CreateGroupRequest = IdempotentRequest & {
  name: string;
  currency: CurrencyCode;
  cover_image_url?: string;
};

export type UpdateGroupRequest = IdempotentRequest & {
  name: string;
  cover_image_url?: string;
};

export type CreateVirtualMemberRequest = IdempotentRequest & {
  display_name: string;
};

export type RenameGroupMemberRequest = IdempotentRequest & {
  display_name: string;
};

export type RemoveGroupMemberRequest = IdempotentRequest;

export type CreateInviteRequest = IdempotentRequest & {
  max_uses: number;
  expires_at?: string;
};

export type AcceptInviteRequest = IdempotentRequest & {
  display_name: string;
  claim_member_id?: string;
};

export type ExpenseKind = "expense" | "income" | "transfer";
export type ShareType = "equal" | "fixed" | "percent";

export type ExpensePaymentInput = {
  payer_member_id: string;
  amount_minor: number;
  currency: CurrencyCode;
};

export type ExpenseShareInput = {
  member_id: string;
  share_type: ShareType;
  share_value?: number;
  amount_minor: number;
};

export type CreateExpenseRequest = IdempotentRequest & {
  title: string;
  kind: ExpenseKind;
  category: string;
  amount_minor: number;
  currency: CurrencyCode;
  expense_date: string;
  note?: string;
  transfer_to_member_id?: string;
  image_url?: string;
  expense_payments: ExpensePaymentInput[];
  expense_shares: ExpenseShareInput[];
};

export type UploadGroupImageRequest = IdempotentRequest & {
  kind: "expense" | "cover";
  data_url: string;
};

export type UpdateMyAvatarRequest = IdempotentRequest & {
  data_url: string;
};

export type ScanReceiptRequest = IdempotentRequest & {
  data_url: string;
  /**
   * The group's currency. A receipt often prints bare numbers, so without this
   * the model has to guess from the language on the paper — and a NT$1,250
   * dinner read as ¥1,250 is silently wrong in a way nobody checks.
   */
  currency: CurrencyCode;
};

export type ScanReceiptLineItem = {
  name: string;
  amount_minor: number | null;
};

export type ScanReceiptResponse = {
  /** false = the photo was processed but isn't a receipt (or is unreadable). */
  recognised: boolean;
  merchant: string | null;
  amount_minor: number | null;
  currency: CurrencyCode | null;
  /** Local calendar date printed on the receipt, YYYY-MM-DD, or null. */
  purchased_at: string | null;
  category: string | null;
  items: ScanReceiptLineItem[];
};

export type ApiResourceId = {
  id: string;
};

export type GroupSummaryResponse = ApiResourceId & {
  name: string;
  currency: CurrencyCode;
  archived_at: string | null;
  cover_image_url?: string | null;
};

export type ExpenseResponse = ApiResourceId & {
  version: number;
  client_request_id: string;
};
