// PUT was missing here while PUT routes already existed (replace_expense,
// and now payment-note) — this list documents the surface, so it has to be
// able to describe every method the runtime actually serves.
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiContract = {
  method: HttpMethod;
  path: string;
  purpose: string;
  requiresAuth: boolean;
  requiresClientRequestId: boolean;
  idempotencyField?: "client_request_id";
};

export const apiContracts: ApiContract[] = [
  {
    method: "GET",
    path: "/api/v1/me",
    purpose: "Read the current Google-only authenticated profile.",
    requiresAuth: true,
    requiresClientRequestId: false,
  },
  {
    method: "GET",
    path: "/api/v1/groups",
    purpose: "List groups visible to the authenticated user.",
    requiresAuth: true,
    requiresClientRequestId: false,
  },
  {
    method: "POST",
    path: "/api/v1/groups",
    purpose: "Create a group and owner member.",
    requiresAuth: true,
    requiresClientRequestId: true,
    idempotencyField: "client_request_id",
  },
  {
    method: "POST",
    path: "/api/v1/groups/:groupId/invites",
    purpose: "Create an invite and store its token hash.",
    requiresAuth: true,
    requiresClientRequestId: true,
    idempotencyField: "client_request_id",
  },
  {
    method: "POST",
    path: "/api/v1/invites/:token/accept",
    purpose: "Accept an invite and claim or create a member.",
    requiresAuth: true,
    requiresClientRequestId: true,
    idempotencyField: "client_request_id",
  },
  {
    method: "POST",
    path: "/api/v1/groups/:groupId/expenses",
    purpose: "Create an expense with payments and shares.",
    requiresAuth: true,
    requiresClientRequestId: true,
    idempotencyField: "client_request_id",
  },
  {
    method: "PUT",
    path: "/api/v1/groups/:groupId/members/:memberId/payment-note",
    purpose: "Set where to pay a member back (收款資訊). Empty string clears it.",
    requiresAuth: true,
    // A replace, so a retry writes the same value — an idempotency key would
    // guard nothing.
    requiresClientRequestId: false,
  },
  {
    method: "POST",
    path: "/api/v1/groups/:groupId/members/:memberId/nudge",
    purpose: "Remind one member who owes the group to settle up.",
    requiresAuth: true,
    // Re-sending is intentional; the recipient's cooldown, not an idempotency
    // key, is what stops a double tap from arriving twice.
    requiresClientRequestId: false,
  },
];
