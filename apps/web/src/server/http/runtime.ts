import type {
  AcceptInviteRequest,
  ConfirmSettlementRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateVirtualMemberRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import type { SupabaseQueryClient } from "../repositories/supabaseGroupRepository.js";
import { authGoogleRoute, authSupabaseRoute } from "../routes/authRoutes.js";
import {
  createGroupRoute,
  createInviteRoute,
  createVirtualMemberRoute,
  archiveGroupRoute,
  acceptInviteRoute,
  deleteGroupRoute,
  listGroupsRoute,
  getGroupDetailRoute,
  updateGroupRoute,
} from "../routes/groupRoutes.js";
import { createExpenseRoute, deleteExpenseRoute } from "../routes/expenseRoutes.js";
import { calculateSettlementRoute, confirmSettlementRoute } from "../routes/settlementRoutes.js";
import { getAuthToken, type HttpRuntimeRequest, type HttpRuntimeResponse } from "./httpTypes.js";
import { errorResponse, jsonResponse } from "./jsonResponse.js";

type RuntimeOptions = {
  client: SupabaseQueryClient;
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
    verifier,
    idToken: token,
  };
}

function body<T>(request: HttpRuntimeRequest): T {
  return request.json as T;
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

      return route.handle(request, match);
    },
  };
}
