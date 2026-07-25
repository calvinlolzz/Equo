import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  AcceptInviteRequest,
  ConfirmSettlementRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateVirtualMemberRequest,
  RenameGroupMemberRequest,
  UpdateGroupRequest,
  UpdateMyAvatarRequest,
  UploadGroupImageRequest,
} from "../../contracts/schemas.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { authGoogleRoute, authSupabaseRoute } from "../routes/authRoutes.js";
import {
  createGroupRoute,
  createInviteRoute,
  createVirtualMemberRoute,
  archiveGroupRoute,
  acceptInviteRoute,
  deleteGroupRoute,
  listArchivedGroupsRoute,
  listGroupsRoute,
  getGroupDetailRoute,
  removeGroupMemberRoute,
  renameGroupMemberRoute,
  unarchiveGroupRoute,
  updateGroupRoute,
} from "../routes/groupRoutes.js";
import { createFeedbackRoute, reportErrorRoute } from "../routes/supportRoutes.js";
import {
  adminGroupDetailRoute,
  adminListAdminsRoute,
  adminRemoveAdminRoute,
  adminSetAdminRoleRoute,
  adminListAuditLogsRoute,
  adminListErrorsRoute,
  adminListFeedbackRoute,
  adminListGroupExpensesRoute,
  adminListGroupsRoute,
  adminListUsersRoute,
  adminMeRoute,
  adminOverviewRoute,
  adminStorageRoute,
  adminSetFeedbackStatusRoute,
  adminSetGroupArchivedRoute,
  adminSetGroupDeletedRoute,
  adminSetUserDisabledRoute,
  adminUserDetailRoute,
} from "../routes/adminRoutes.js";
import {
  createExpenseRoute,
  deleteExpenseRoute,
  listExpensesPageRoute,
  replaceExpenseRoute,
} from "../routes/expenseRoutes.js";
import { updateMyAvatarRoute, uploadGroupImageRoute } from "../routes/imageRoutes.js";
import { deleteMyAccountRoute } from "../routes/accountRoutes.js";
import { calculateSettlementRoute, confirmSettlementRoute } from "../routes/settlementRoutes.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";
import { getAuthToken, type HttpRuntimeRequest, type HttpRuntimeResponse } from "./httpTypes.js";
import { errorResponse, jsonResponse } from "./jsonResponse.js";

type RuntimeOptions = {
  client: PostgrestClient;
  storage: SupabaseStorageClient;
  verifier: GoogleTokenVerifier;
  supabaseVerifier?: GoogleTokenVerifier;
  sessionSecret?: string;
  now?: number;
};

type RuntimeRoute = {
  method: string;
  pattern: RegExp;
  label: string;
  handle: (request: HttpRuntimeRequest, match: RegExpMatchArray) => Promise<HttpRuntimeResponse>;
};

function routeOptions(options: RuntimeOptions, request: HttpRuntimeRequest) {
  const token = getAuthToken(request);
  const verifier: GoogleTokenVerifier = async (idToken) => {
    if (options.sessionSecret) {
      const sessionIdentity = verifySessionToken(idToken, options.sessionSecret, options.now);

      if (sessionIdentity) {
        return sessionIdentity;
      }
    }

    return options.verifier(idToken);
  };

  return {
    client: options.client,
    storage: options.storage,
    verifier,
    idToken: token,
  };
}

function body<T>(request: HttpRuntimeRequest): T {
  return request.json as T;
}

/**
 * Correlation id for an unexpected 500. The same value goes to the client
 * (so a user can quote it in a bug report) and to the server log line that
 * carries the real stack - the stack itself never leaves the backend.
 */
function newErrorRequestId(): string {
  return `req_err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function queryParam(request: HttpRuntimeRequest, name: string): string | undefined {
  const value = request.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createHttpRuntime(options: RuntimeOptions) {
  const routes: RuntimeRoute[] = [
    {
      method: "POST",
      pattern: /^\/api\/v1\/auth\/google$/,
      label: "POST /api/v1/auth/google",
      async handle(request) {
        if (!options.sessionSecret) {
          return errorResponse(503, "RUNTIME_ENV_MISSING", "Missing runtime env: SESSION_SECRET", "req_runtime_env");
        }

        const result = await authGoogleRoute(
          {
            client: options.client,
            verifier: options.verifier,
            sessionSecret: options.sessionSecret,
            now: options.now,
          },
          body<{ id_token?: string }>(request),
        );
        const response = jsonResponse(result.status, result.body);
        return { ...response, headers: { ...response.headers, ...result.headers } };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/groups$/,
      label: "GET /api/v1/groups",
      async handle(request) {
        const result = await listGroupsRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/groups\/archived$/,
      label: "GET /api/v1/groups/archived",
      async handle(request) {
        const result = await listArchivedGroupsRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/auth\/supabase$/,
      label: "POST /api/v1/auth/supabase",
      async handle(request) {
        if (!options.sessionSecret || !options.supabaseVerifier) {
          return errorResponse(503, "RUNTIME_ENV_MISSING", "Missing runtime env: SESSION_SECRET", "req_runtime_env");
        }

        const result = await authSupabaseRoute(
          {
            client: options.client,
            verifier: options.supabaseVerifier,
            sessionSecret: options.sessionSecret,
            now: options.now,
          },
          body<{ access_token?: string }>(request),
        );
        const response = jsonResponse(result.status, result.body);
        return { ...response, headers: { ...response.headers, ...result.headers } };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups$/,
      label: "POST /api/v1/groups",
      async handle(request) {
        const result = await createGroupRoute(routeOptions(options, request), body<CreateGroupRequest>(request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/groups\/([^/]+)$/,
      label: "GET /api/v1/groups/:groupId",
      async handle(request, match) {
        const result = await getGroupDetailRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/v1\/groups\/([^/]+)$/,
      label: "PATCH /api/v1/groups/:groupId",
      async handle(request, match) {
        const result = await updateGroupRoute(routeOptions(options, request), match[1], body<UpdateGroupRequest>(request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/members$/,
      label: "POST /api/v1/groups/:groupId/members",
      async handle(request, match) {
        const result = await createVirtualMemberRoute(
          routeOptions(options, request),
          match[1],
          body<CreateVirtualMemberRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)$/,
      label: "PATCH /api/v1/groups/:groupId/members/:memberId",
      async handle(request, match) {
        const result = await renameGroupMemberRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          body<RenameGroupMemberRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)$/,
      label: "DELETE /api/v1/groups/:groupId/members/:memberId",
      async handle(request, match) {
        const payload = body<{ client_request_id: string }>(request);
        const result = await removeGroupMemberRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          payload.client_request_id,
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/archive$/,
      label: "POST /api/v1/groups/:groupId/archive",
      async handle(request, match) {
        const payload = body<{ client_request_id: string }>(request);
        const result = await archiveGroupRoute(routeOptions(options, request), match[1], payload.client_request_id);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/unarchive$/,
      label: "POST /api/v1/groups/:groupId/unarchive",
      async handle(request, match) {
        const payload = body<{ client_request_id: string }>(request);
        const result = await unarchiveGroupRoute(routeOptions(options, request), match[1], payload.client_request_id);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/groups\/([^/]+)$/,
      label: "DELETE /api/v1/groups/:groupId",
      async handle(request, match) {
        const payload = body<{ client_request_id: string }>(request);
        const result = await deleteGroupRoute(routeOptions(options, request), match[1], payload.client_request_id);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/invites$/,
      label: "POST /api/v1/groups/:groupId/invites",
      async handle(request, match) {
        const result = await createInviteRoute(
          routeOptions(options, request),
          match[1],
          body<CreateInviteRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/invites\/([^/]+)\/accept$/,
      label: "POST /api/v1/invites/:token/accept",
      async handle(request, match) {
        const result = await acceptInviteRoute(
          routeOptions(options, request),
          match[1],
          body<AcceptInviteRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/expenses$/,
      label: "POST /api/v1/groups/:groupId/expenses",
      async handle(request, match) {
        const result = await createExpenseRoute(
          routeOptions(options, request),
          match[1],
          body<CreateExpenseRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/expenses$/,
      label: "GET /api/v1/groups/:groupId/expenses",
      async handle(request, match) {
        const limitParam = queryParam(request, "limit");
        const result = await listExpensesPageRoute(routeOptions(options, request), match[1], {
          limit: limitParam ? Number(limitParam) : undefined,
          before_date: queryParam(request, "before_date"),
          before_created_at: queryParam(request, "before_created_at"),
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/images$/,
      label: "POST /api/v1/groups/:groupId/images",
      async handle(request, match) {
        const result = await uploadGroupImageRoute(
          routeOptions(options, request),
          match[1],
          body<UploadGroupImageRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/v1\/me\/avatar$/,
      label: "PATCH /api/v1/me/avatar",
      async handle(request) {
        const result = await updateMyAvatarRoute(routeOptions(options, request), body<UpdateMyAvatarRequest>(request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/me$/,
      label: "DELETE /api/v1/me",
      async handle(request) {
        const result = await deleteMyAccountRoute(routeOptions(options, request));
        const response = jsonResponse(result.status, result.body);
        // Success carries a Set-Cookie clearing the session — merge it in like
        // the auth routes do.
        return "headers" in result && result.headers
          ? { ...response, headers: { ...response.headers, ...result.headers } }
          : response;
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/expenses\/([^/]+)$/,
      label: "PUT /api/v1/groups/:groupId/expenses/:expenseId",
      async handle(request, match) {
        const result = await replaceExpenseRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          body<CreateExpenseRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/expenses\/([^/]+)$/,
      label: "DELETE /api/v1/groups/:groupId/expenses/:expenseId",
      async handle(request, match) {
        const payload = body<{ client_request_id: string }>(request);
        const result = await deleteExpenseRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          payload.client_request_id,
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/feedback$/,
      label: "POST /api/v1/feedback",
      async handle(request) {
        const result = await createFeedbackRoute(
          routeOptions(options, request),
          body<{ type?: string; message?: string; contact?: string; page?: string }>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/errors$/,
      label: "POST /api/v1/errors",
      async handle(request) {
        const result = await reportErrorRoute(
          routeOptions(options, request),
          body<{ source?: string; message?: string; context?: string; page?: string }>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/feedback$/,
      label: "GET /api/v1/admin/feedback",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListFeedbackRoute(routeOptions(options, request), {
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
          status: queryParam(request, "status"),
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/feedback\/([^/]+)\/status$/,
      label: "POST /api/v1/admin/feedback/:feedbackId/status",
      async handle(request, match) {
        const payload = body<{ status?: string }>(request);
        const result = await adminSetFeedbackStatusRoute(routeOptions(options, request), match[1], payload.status);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/errors$/,
      label: "GET /api/v1/admin/errors",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListErrorsRoute(routeOptions(options, request), {
          search: queryParam(request, "search"),
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/me$/,
      label: "GET /api/v1/admin/me",
      async handle(request) {
        const result = await adminMeRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/overview$/,
      label: "GET /api/v1/admin/overview",
      async handle(request) {
        const result = await adminOverviewRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/storage$/,
      label: "GET /api/v1/admin/storage",
      async handle(request) {
        const result = await adminStorageRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/admins$/,
      label: "GET /api/v1/admin/admins",
      async handle(request) {
        const result = await adminListAdminsRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/admins$/,
      label: "POST /api/v1/admin/admins",
      async handle(request) {
        const payload = body<{ email?: string; role?: string }>(request);
        const result = await adminSetAdminRoleRoute(routeOptions(options, request), payload.email, payload.role);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/admins\/([^/]+)\/remove$/,
      label: "POST /api/v1/admin/admins/:userId/remove",
      async handle(request, match) {
        const result = await adminRemoveAdminRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/users$/,
      label: "GET /api/v1/admin/users",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListUsersRoute(routeOptions(options, request), {
          search: queryParam(request, "search"),
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/users\/([^/]+)$/,
      label: "GET /api/v1/admin/users/:userId",
      async handle(request, match) {
        const result = await adminUserDetailRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/groups$/,
      label: "GET /api/v1/admin/groups",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListGroupsRoute(routeOptions(options, request), {
          search: queryParam(request, "search"),
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
          filter: queryParam(request, "filter"),
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)$/,
      label: "GET /api/v1/admin/groups/:groupId",
      async handle(request, match) {
        const result = await adminGroupDetailRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)\/expenses$/,
      label: "GET /api/v1/admin/groups/:groupId/expenses",
      async handle(request, match) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListGroupExpensesRoute(routeOptions(options, request), match[1], {
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
          include_deleted: queryParam(request, "include_deleted") === "true",
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/audit$/,
      label: "GET /api/v1/admin/audit",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListAuditLogsRoute(routeOptions(options, request), {
          search: queryParam(request, "search"),
          action: queryParam(request, "action"),
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/users\/([^/]+)\/(disable|enable)$/,
      label: "POST /api/v1/admin/users/:userId/(disable|enable)",
      async handle(request, match) {
        const result = await adminSetUserDisabledRoute(routeOptions(options, request), match[1], match[2] === "disable");
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)\/(archive|unarchive)$/,
      label: "POST /api/v1/admin/groups/:groupId/(archive|unarchive)",
      async handle(request, match) {
        const result = await adminSetGroupArchivedRoute(routeOptions(options, request), match[1], match[2] === "archive");
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)\/(delete|restore)$/,
      label: "POST /api/v1/admin/groups/:groupId/(delete|restore)",
      async handle(request, match) {
        const result = await adminSetGroupDeletedRoute(routeOptions(options, request), match[1], match[2] === "delete");
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/settlement\/calculate$/,
      label: "POST /api/v1/groups/:groupId/settlement/calculate",
      async handle(request, match) {
        const result = await calculateSettlementRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/settlement\/([^/]+)\/confirm$/,
      label: "POST /api/v1/groups/:groupId/settlement/:settlementId/confirm",
      async handle(request, match) {
        const result = await confirmSettlementRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          body<ConfirmSettlementRequest>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
  ];

  return {
    routes,
    async handle(request: HttpRuntimeRequest): Promise<HttpRuntimeResponse> {
      const route = routes.find((candidate) => {
        return candidate.method === request.method && request.path.match(candidate.pattern);
      });

      if (!route) {
        return errorResponse(404, "FORBIDDEN", "Unknown API route.", "req_not_found");
      }

      const match = request.path.match(route.pattern);

      if (!match) {
        return errorResponse(404, "FORBIDDEN", "Unknown API route.", "req_not_found");
      }

      // Single choke point for unexpected exceptions: any handler that throws
      // (a DB request that 500s, a bug, a downstream timeout) is converted
      // into the same structured error shape the deliberate error paths use
      // (403 FORBIDDEN, 400 issues, ...) instead of bubbling up and letting
      // the platform emit a raw FUNCTION_INVOCATION_FAILED string with
      // internal node/trace ids. The real error - stack included - is logged
      // server-side against the request_id we hand back to the caller.
      try {
        return await route.handle(request, match);
      } catch (error) {
        const request_id = newErrorRequestId();
        console.error(`[${request_id}] ${route.label} failed:`, error);
        return errorResponse(500, "INTERNAL_ERROR", "An internal error occurred.", request_id);
      }
    },
  };
}
