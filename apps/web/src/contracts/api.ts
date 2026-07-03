export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

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
    method: "POST",
    path: "/api/v1/groups/:groupId/settlement/calculate",
    purpose: "Calculate the current settlement draft.",
    requiresAuth: true,
    requiresClientRequestId: false,
  },
  {
    method: "POST",
    path: "/api/v1/groups/:groupId/settlement/:settlementId/confirm",
    purpose: "Confirm a settlement with version conflict protection.",
    requiresAuth: true,
    requiresClientRequestId: true,
    idempotencyField: "client_request_id",
  },
];
