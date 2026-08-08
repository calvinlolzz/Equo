import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  AcceptInviteRequest,
  ConfirmSettlementRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateVirtualMemberRequest,
  RenameGroupMemberRequest,
  ScanReceiptRequest,
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
  markGroupReadRoute,
  removeGroupMemberRoute,
  renameGroupMemberRoute,
  unarchiveGroupRoute,
  updateGroupRoute,
} from "../routes/groupRoutes.js";
import { createFeedbackRoute, reportErrorRoute } from "../routes/supportRoutes.js";
import {
  adminDeleteUserRoute,
  adminExportUserRoute,
  adminGroupDetailRoute,
  adminMergeUsersRoute,
  adminGetCatalogRoute,
  adminDeleteNotificationBatchRoute,
  adminListSentNotificationsRoute,
  adminReplyFeedbackRoute,
  adminSaveCategoryRoute,
  adminSaveCurrencyRoute,
  adminSendNotificationRoute,
  adminSetRateOverrideRoute,
  adminSetExpenseDeletedRoute,
  adminTransferGroupOwnerRoute,
  adminUpdateExpenseMetaRoute,
  adminListAdminsRoute,
  adminRemoveAdminRoute,
  adminSetAdminRoleRoute,
  adminListAuditLogsRoute,
  adminListErrorGroupsRoute,
  adminListErrorsRoute,
  adminSetErrorGroupStatusRoute,
  adminListFeedbackRoute,
  adminListGroupExpensesRoute,
  adminListGroupsRoute,
  adminListUsersRoute,
  adminMeRoute,
  adminHealthRoute,
  adminOverviewRoute,
  adminStorageRoute,
  adminTrendsRoute,
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
  searchExpensesRoute,
  replaceExpenseRoute,
} from "../routes/expenseRoutes.js";
import { updateMyAvatarRoute, uploadGroupImageRoute } from "../routes/imageRoutes.js";
import { scanReceiptRoute } from "../routes/receiptRoutes.js";
import {
  RECEIPT_SCAN_DEFAULT_MODEL,
  type ReceiptScanKeys,
  type ReceiptScanner,
} from "../runtime/receiptScanner.js";
import {
  adminGetReceiptScanSettingsRoute,
  adminSetReceiptScanSettingsRoute,
} from "../routes/adminRoutes.js";
import { deleteMyAccountRoute } from "../routes/accountRoutes.js";
import { exchangeRatesRoute } from "../routes/exchangeRateRoutes.js";
import { pushPublicKeyRoute, subscribePushRoute, unsubscribePushRoute } from "../routes/pushRoutes.js";
import { sendNudgeRoute } from "../routes/nudgeRoutes.js";
import { getSpendBreakdownRoute } from "../routes/spendRoutes.js";
import {
  deleteNotificationsRoute,
  listNotificationsRoute,
  markNotificationsReadRoute,
} from "../routes/notificationRoutes.js";
import { getCatalogRoute } from "../routes/catalogRoutes.js";
import type { AdminSendNotificationBody } from "../handlers/admin.js";
import { createSupabasePushRepository } from "../repositories/supabasePushRepository.js";
import { notifyExpenseCreated, notifyMemberJoined, notifyNudge } from "../push/pushSender.js";
import type { PushSendFn, VapidKeys } from "../push/pushSender.js";
import { healthRoute } from "../routes/healthRoutes.js";
import { calculateSettlementRoute, confirmSettlementRoute } from "../routes/settlementRoutes.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";
import { getAuthToken, type HttpRuntimeRequest, type HttpRuntimeResponse } from "./httpTypes.js";
import { errorResponse, jsonResponse } from "./jsonResponse.js";
import { enforceRateLimit } from "./rateLimit.js";

type RuntimeOptions = {
  client: PostgrestClient;
  storage: SupabaseStorageClient;
  verifier: GoogleTokenVerifier;
  supabaseVerifier?: GoogleTokenVerifier;
  sessionSecret?: string;
  now?: number;
  /**
   * Absent = this deployment has push switched off: the subscribe endpoints
   * still store rows, GET /push/public-key reports enabled:false, and nothing
   * is ever delivered. Keeping it optional means a missing VAPID key cannot
   * take the rest of the API down with it.
   */
  vapid?: VapidKeys;
  /** Test seam: the push transport. Defaults to web-push. */
  pushSend?: PushSendFn;
  /**
   * Absent = receipt recognition is switched off for the same reason as vapid:
   * POST /receipts/scan answers 503 RECEIPT_SCAN_UNAVAILABLE and the client
   * falls back to attaching the photo, rather than the missing key taking the
   * rest of the API down.
   */
  scanReceipt?: ReceiptScanner;
  /**
   * The deployment's default recognition model, used until an admin picks one
   * in the console. The saved choice wins; this is only the fallback.
   */
  receiptScanModel?: string;
  /** Which providers have keys here, so the console can mark each model runnable or not. */
  receiptScanKeys?: ReceiptScanKeys;
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

/** What the deployment contributes to the settings picture: the key, and the fallback model. */
function receiptScanConfig(options: RuntimeOptions) {
  return {
    keys: options.receiptScanKeys ?? {},
    defaultModel: options.receiptScanModel?.trim() || RECEIPT_SCAN_DEFAULT_MODEL,
  };
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
    // GET and HEAD both answer the health probe. Uptime monitors (UptimeRobot,
    // and load balancers generally) default to HEAD, and a GET-only health
    // endpoint 404s under exactly the tool meant to watch it. Same status and
    // headers; the platform drops the body for a HEAD response on its own.
    ...(["GET", "HEAD"] as const).map((method) => ({
      method,
      pattern: /^\/api\/v1\/health$/,
      label: `${method} /api/v1/health`,
      async handle() {
        const result = await healthRoute({ client: options.client, now: options.now });
        const response = jsonResponse(result.status, result.body);
        // Monitors poll this constantly; never let a CDN or the browser serve
        // a stale "ok" through an outage.
        return { ...response, headers: { ...response.headers, "cache-control": "no-store" } };
      },
    })),
    {
      method: "GET",
      pattern: /^\/api\/v1\/exchange-rates$/,
      label: "GET /api/v1/exchange-rates",
      async handle(request) {
        const result = await exchangeRatesRoute(
          { ...routeOptions(options, request), now: options.now },
          queryParam(request, "base"),
        );
        const response = jsonResponse(result.status, result.body);
        // The rates are the same for everyone and change once a day; let the
        // browser reuse them for an hour rather than asking on every open.
        // Private, since the endpoint is authenticated and a shared CDN cache
        // would serve one user's response to the next caller.
        return {
          ...response,
          headers: {
            ...response.headers,
            "cache-control": result.status === 200 ? "private, max-age=3600" : "no-store",
          },
        };
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
      pattern: /^\/api\/v1\/groups\/([^/]+)\/read$/,
      label: "POST /api/v1/groups/:groupId/read",
      async handle(request, match) {
        const result = await markGroupReadRoute(routeOptions(options, request), match[1]);
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

        // Same rules as the expense fan-out: after the write, awaited (a
        // serverless function can be frozen the moment it responds), and never
        // able to change the response.
        if (result.ok && options.vapid && "actorUserId" in result && "group" in result.body) {
          const group = result.body.group as { id: string };

          await notifyMemberJoined({
            repository: createSupabasePushRepository(options.client),
            vapid: options.vapid,
            groupId: group.id,
            actorUserId: result.actorUserId,
            send: options.pushSend,
          });
        }

        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/expenses$/,
      label: "POST /api/v1/groups/:groupId/expenses",
      async handle(request, match) {
        const groupId = match[1];
        const result = await createExpenseRoute(
          routeOptions(options, request),
          groupId,
          body<CreateExpenseRequest>(request),
        );

        // Notify AFTER the write, never before, and never in a way that can
        // change the response. The await is deliberate: a serverless function
        // can be frozen the moment it responds, so work started and not waited
        // for is work that may never happen. Group sizes here are small enough
        // that the fan-out is a handful of parallel requests.
        if (result.ok && options.vapid && "expense" in result.body) {
          const created = result.body.expense as {
            title: string;
            amount_minor: number;
            currency: string;
            kind: string;
          };
          const actorUserId = "actorUserId" in result ? result.actorUserId : undefined;

          if (actorUserId) {
            await notifyExpenseCreated({
              repository: createSupabasePushRepository(options.client),
              vapid: options.vapid,
              groupId,
              actorUserId,
              expense: created,
              send: options.pushSend,
            });
          }
        }

        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)\/nudge$/,
      label: "POST /api/v1/groups/:groupId/members/:memberId/nudge",
      async handle(request, match) {
        const result = await sendNudgeRoute(routeOptions(options, request), match[1], match[2]);

        // The reminder IS the notification: unlike the expense fan-out, there
        // is nothing else the recipient could learn from this write, so a
        // deployment without VAPID keys has simply written a row nobody sees.
        // Still a 200 - the sender's request was valid, and the cooldown that
        // was started is real.
        if (result.ok && options.vapid && "notify" in result && result.notify) {
          const notify = result.notify;

          await notifyNudge({
            repository: createSupabasePushRepository(options.client),
            vapid: options.vapid,
            groupId: notify.groupId,
            toMemberId: notify.toMemberId,
            groupName: notify.groupName,
            fromName: notify.fromName,
            balanceMinor: notify.balanceMinor,
            currency: notify.currency,
            send: options.pushSend,
          });
        }

        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/push\/public-key$/,
      label: "GET /api/v1/push/public-key",
      async handle(request) {
        const result = await pushPublicKeyRoute(routeOptions(options, request), options.vapid?.publicKey);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/push\/subscribe$/,
      label: "POST /api/v1/push/subscribe",
      async handle(request) {
        const result = await subscribePushRoute(routeOptions(options, request), body(request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/push\/unsubscribe$/,
      label: "POST /api/v1/push/unsubscribe",
      async handle(request) {
        const result = await unsubscribePushRoute(routeOptions(options, request), body(request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/groups\/([^/]+)\/spend-breakdown$/,
      label: "GET /api/v1/groups/:groupId/spend-breakdown",
      async handle(request, match) {
        const result = await getSpendBreakdownRoute(routeOptions(options, request), match[1], {
          kind: queryParam(request, "kind"),
          key: queryParam(request, "key"),
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      // Registered before the plain /expenses route so "search" is never
      // mistaken for a page cursor on it.
      pattern: /^\/api\/v1\/groups\/([^/]+)\/expenses\/search$/,
      label: "GET /api/v1/groups/:groupId/expenses/search",
      async handle(request, match) {
        const limitParam = queryParam(request, "limit");
        const result = await searchExpensesRoute(routeOptions(options, request), match[1], {
          q: queryParam(request, "q"),
          member_id: queryParam(request, "member_id"),
          category: queryParam(request, "category"),
          kind: queryParam(request, "kind"),
          from: queryParam(request, "from"),
          to: queryParam(request, "to"),
          limit: limitParam ? Number(limitParam) : undefined,
          before_date: queryParam(request, "before_date"),
          before_created_at: queryParam(request, "before_created_at"),
        });
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
      method: "GET",
      pattern: /^\/api\/v1\/admin\/settings\/receipt-scan$/,
      label: "GET /api/v1/admin/settings/receipt-scan",
      async handle(request) {
        const result = await adminGetReceiptScanSettingsRoute(routeOptions(options, request), receiptScanConfig(options));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/v1\/admin\/settings\/receipt-scan$/,
      label: "PUT /api/v1/admin/settings/receipt-scan",
      async handle(request) {
        const result = await adminSetReceiptScanSettingsRoute(
          routeOptions(options, request),
          body<{ enabled?: unknown; model?: unknown }>(request),
          receiptScanConfig(options),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/receipts\/scan$/,
      label: "POST /api/v1/receipts/scan",
      async handle(request) {
        const result = await scanReceiptRoute(
          {
            ...routeOptions(options, request),
            scanReceipt: options.scanReceipt,
            defaultModel: options.receiptScanModel,
          },
          body<ScanReceiptRequest>(request),
        );
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
          fingerprint: queryParam(request, "fingerprint"),
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/error-groups$/,
      label: "GET /api/v1/admin/error-groups",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListErrorGroupsRoute(routeOptions(options, request), {
          search: queryParam(request, "search"),
          status: queryParam(request, "status"),
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/error-groups\/([^/]+)\/status$/,
      label: "POST /api/v1/admin/error-groups/:fingerprint/status",
      async handle(request, match) {
        const payload = body<{ status?: string }>(request);
        const result = await adminSetErrorGroupStatusRoute(
          routeOptions(options, request),
          decodeURIComponent(match[1]),
          payload.status,
        );
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
      pattern: /^\/api\/v1\/admin\/trends$/,
      label: "GET /api/v1/admin/trends",
      async handle(request) {
        const result = await adminTrendsRoute(routeOptions(options, request), queryParam(request, "days"));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/health$/,
      label: "GET /api/v1/admin/health",
      async handle(request) {
        const result = await adminHealthRoute(routeOptions(options, request), receiptScanConfig(options));
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
      method: "GET",
      pattern: /^\/api\/v1\/catalog$/,
      label: "GET /api/v1/catalog",
      async handle(request) {
        const result = await getCatalogRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/catalog$/,
      label: "GET /api/v1/admin/catalog",
      async handle(request) {
        const result = await adminGetCatalogRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/v1\/admin\/catalog\/categories\/([^/]+)$/,
      label: "PUT /api/v1/admin/catalog/categories/:key",
      async handle(request, match) {
        const result = await adminSaveCategoryRoute(
          routeOptions(options, request),
          match[1],
          body<{ label?: unknown; color?: unknown; sort_order?: unknown; enabled?: unknown }>(request) ?? {},
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/v1\/admin\/catalog\/currencies\/([^/]+)$/,
      label: "PUT /api/v1/admin/catalog/currencies/:code",
      async handle(request, match) {
        const result = await adminSaveCurrencyRoute(
          routeOptions(options, request),
          match[1],
          body<{ label?: unknown; sort_order?: unknown; enabled?: unknown }>(request) ?? {},
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/v1\/admin\/catalog\/rates$/,
      label: "PUT /api/v1/admin/catalog/rates",
      async handle(request) {
        const result = await adminSetRateOverrideRoute(
          routeOptions(options, request),
          body<{ base?: unknown; quote?: unknown; rate?: unknown; note?: unknown }>(request) ?? {},
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/notifications$/,
      label: "GET /api/v1/notifications",
      async handle(request) {
        const result = await listNotificationsRoute(routeOptions(options, request));
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/notifications\/read$/,
      label: "POST /api/v1/notifications/read",
      async handle(request) {
        const result = await markNotificationsReadRoute(
          routeOptions(options, request),
          body<{ ids?: unknown }>(request) ?? {},
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/notifications$/,
      label: "DELETE /api/v1/notifications",
      async handle(request) {
        const result = await deleteNotificationsRoute(
          routeOptions(options, request),
          body<{ ids?: unknown }>(request) ?? {},
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/notifications$/,
      label: "GET /api/v1/admin/notifications",
      async handle(request) {
        const limitParam = queryParam(request, "limit");
        const offsetParam = queryParam(request, "offset");
        const result = await adminListSentNotificationsRoute(routeOptions(options, request), {
          limit: limitParam ? Number(limitParam) : undefined,
          offset: offsetParam ? Number(offsetParam) : undefined,
        });
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/admin\/notifications\/([^/]+)$/,
      label: "DELETE /api/v1/admin/notifications/:batchId",
      async handle(request, match) {
        const result = await adminDeleteNotificationBatchRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/notifications$/,
      label: "POST /api/v1/admin/notifications",
      async handle(request) {
        const result = await adminSendNotificationRoute(
          routeOptions(options, request),
          body<AdminSendNotificationBody>(request) ?? {},
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/feedback\/([^/]+)\/reply$/,
      label: "POST /api/v1/admin/feedback/:feedbackId/reply",
      async handle(request, match) {
        const payload = body<{ message?: unknown }>(request);
        const result = await adminReplyFeedbackRoute(routeOptions(options, request), match[1], payload?.message);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)\/expenses\/([^/]+)\/(delete|restore)$/,
      label: "POST /api/v1/admin/groups/:groupId/expenses/:expenseId/(delete|restore)",
      async handle(request, match) {
        const result = await adminSetExpenseDeletedRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          match[3] === "delete",
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)\/expenses\/([^/]+)$/,
      label: "PATCH /api/v1/admin/groups/:groupId/expenses/:expenseId",
      async handle(request, match) {
        const result = await adminUpdateExpenseMetaRoute(
          routeOptions(options, request),
          match[1],
          match[2],
          body<{ title?: unknown; category?: unknown; expense_date?: unknown; note?: unknown }>(request),
        );
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/groups\/([^/]+)\/transfer-owner$/,
      label: "POST /api/v1/admin/groups/:groupId/transfer-owner",
      async handle(request, match) {
        const payload = body<{ member_id?: string }>(request);
        const result = await adminTransferGroupOwnerRoute(routeOptions(options, request), match[1], payload?.member_id);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/v1\/admin\/users\/([^/]+)\/merge$/,
      label: "POST /api/v1/admin/users/:userId/merge",
      async handle(request, match) {
        const payload = body<{ target_user_id?: string }>(request);
        const result = await adminMergeUsersRoute(routeOptions(options, request), match[1], payload?.target_user_id);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/v1\/admin\/users\/([^/]+)\/export$/,
      label: "GET /api/v1/admin/users/:userId/export",
      async handle(request, match) {
        const result = await adminExportUserRoute(routeOptions(options, request), match[1]);
        return jsonResponse(result.status, result.body);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/v1\/admin\/users\/([^/]+)$/,
      label: "DELETE /api/v1/admin/users/:userId",
      async handle(request, match) {
        const result = await adminDeleteUserRoute(routeOptions(options, request), match[1]);
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
      // Before routing, so an unknown path costs an attacker the same budget as
      // a real one and probing can't be used to sidestep the cap.
      const limit = await enforceRateLimit(
        { client: options.client, sessionSecret: options.sessionSecret, now: options.now },
        request,
      );

      if (!limit.allowed) {
        const response = errorResponse(429, "RATE_LIMITED", "Too many requests. Try again shortly.", "req_rate_limited");
        return {
          ...response,
          headers: { ...response.headers, "retry-after": String(limit.retryAfterSeconds) },
        };
      }

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
