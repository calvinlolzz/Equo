import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseAdminRepository } from "../repositories/supabaseAdminRepository.js";
import { createSupabaseSettingsRepository } from "../repositories/supabaseSettingsRepository.js";
import { availableReceiptScanModels, type ReceiptScanKeys } from "../runtime/receiptScanner.js";
import {
  handleAdminDeleteUser,
  handleAdminExportUser,
  handleAdminGetCatalog,
  handleAdminSaveCategory,
  handleAdminSaveCurrency,
  handleAdminSetRateOverride,
  handleAdminGetAutoNudgeSettings,
  handleAdminGetSiteNotice,
  handleAdminRetention,
  handleAdminLogExport,
  handleAdminViewAs,
  handleAdminSetSiteNotice,
  handleAdminGetReceiptScanSettings,
  handleAdminSetAutoNudgeSettings,
  handleAdminReceiptScanUsage,
  handleAdminGroupDetail,
  handleAdminHealth,
  handleAdminMergeUsers,
  handleAdminDeleteNotificationBatch,
  handleAdminListSentNotifications,
  handleAdminReplyFeedback,
  handleAdminSendNotification,
  handleAdminSetExpenseDeleted,
  handleAdminTransferGroupOwner,
  handleAdminUpdateExpenseMeta,
  handleAdminSetReceiptScanSettings,
  handleAdminTrends,
  handleAdminListAdmins,
  handleAdminRemoveAdmin,
  handleAdminSetAdminRole,
  handleAdminListAuditLogs,
  handleAdminListErrorGroups,
  handleAdminListErrors,
  handleAdminSetErrorGroupStatus,
  handleAdminListFeedback,
  handleAdminListGroupExpenses,
  handleAdminListGroups,
  handleAdminListUsers,
  handleAdminMe,
  handleAdminOverview,
  handleAdminStorage,
  handleAdminSetFeedbackStatus,
  handleAdminSetGroupArchived,
  handleAdminSetGroupDeleted,
  handleAdminSetUserDisabled,
  handleAdminUserDetail,
  type AdminAuditLogQuery,
  type AdminErrorListQuery,
  type AdminExpenseListQuery,
  type AdminFeedbackListQuery,
  type AdminGroupListQuery,
  type AdminListQuery,
  type AdminSendNotificationBody,
} from "../handlers/admin.js";
import { resetSiteNoticeCache } from "../http/maintenance.js";
import { createViewAsCookie, createViewAsToken, clearViewAsCookie, VIEW_AS_TTL_MS } from "../auth/sessionToken.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
  /** Needed only by the view-as route, which signs a token. */
  sessionSecret?: string;
  now?: number;
};


export async function adminMeRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminMe(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminOverviewRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminOverview(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminRetentionRoute(
  options: RouteOptions,
  period: string | undefined,
  periods: string | undefined,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminRetention(createSupabaseAdminRepository(options.client), auth.context, period, periods);
}

export async function adminTrendsRoute(options: RouteOptions, days: string | undefined) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminTrends(createSupabaseAdminRepository(options.client), auth.context, days);
}

export async function adminHealthRoute(
  options: RouteOptions,
  receiptScan?: { keys: ReceiptScanKeys; defaultModel: string },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  let tile: { configured: boolean; enabled: boolean; model: string } | undefined;

  if (receiptScan) {
    // "configured" is per-model now: the selected model's provider is what has
    // to have a key, not the feature in the abstract.
    const runnable = (model: string) =>
      availableReceiptScanModels(receiptScan.keys).some((entry) => entry.id === model);

    try {
      const saved = await createSupabaseSettingsRepository(options.client).getReceiptScan(receiptScan.defaultModel);
      tile = { configured: runnable(saved.model), enabled: saved.enabled !== false, model: saved.model };
    } catch {
      // Same fail-open as the scan path: a console ahead of its migration must
      // still render the rest of the health card rather than 500.
      tile = { configured: runnable(receiptScan.defaultModel), enabled: true, model: receiptScan.defaultModel };
    }
  }

  return handleAdminHealth(createSupabaseAdminRepository(options.client), auth.context, tile);
}

export async function adminGetReceiptScanSettingsRoute(
  options: RouteOptions,
  config: { keys: ReceiptScanKeys; defaultModel: string },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminGetReceiptScanSettings(
    createSupabaseAdminRepository(options.client),
    createSupabaseSettingsRepository(options.client),
    auth.context,
    config.defaultModel,
    config.keys,
  );
}

export async function adminSetReceiptScanSettingsRoute(
  options: RouteOptions,
  body: { enabled?: unknown; model?: unknown },
  config: { keys: ReceiptScanKeys; defaultModel: string },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetReceiptScanSettings(
    createSupabaseAdminRepository(options.client),
    createSupabaseSettingsRepository(options.client),
    auth.context,
    body,
    config.defaultModel,
    config.keys,
  );
}

export async function adminListAdminsRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListAdmins(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminSetAdminRoleRoute(
  options: RouteOptions,
  email: string | undefined,
  role: string | undefined,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetAdminRole(createSupabaseAdminRepository(options.client), auth.context, email, role);
}

export async function adminRemoveAdminRoute(options: RouteOptions, userId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminRemoveAdmin(createSupabaseAdminRepository(options.client), auth.context, userId);
}

export async function adminGetAutoNudgeRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminGetAutoNudgeSettings(
    createSupabaseAdminRepository(options.client),
    createSupabaseSettingsRepository(options.client),
    auth.context,
  );
}

export async function adminSetAutoNudgeRoute(
  options: RouteOptions,
  body: { enabled?: unknown; overdue_days?: unknown; cooldown_days?: unknown },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetAutoNudgeSettings(
    createSupabaseAdminRepository(options.client),
    createSupabaseSettingsRepository(options.client),
    auth.context,
    body,
  );
}

/**
 * Open a read-only view as one user.
 *
 * Signs a short-lived token shaped like a session and sets it as its OWN
 * cookie. The admin's real equo_session is untouched, so leaving the view is
 * just clearing this one - there is no moment where a mistake could sign them
 * out of their own account or strand them as somebody else.
 */
export async function adminLogExportRoute(
  options: RouteOptions,
  body: { kind?: unknown; rows?: unknown; total?: unknown; search?: unknown },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminLogExport(createSupabaseAdminRepository(options.client), auth.context, body ?? {});
}

export async function adminViewAsRoute(options: RouteOptions, body: { user_id?: unknown }) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  if (!options.sessionSecret) {
    return {
      ok: false,
      status: 500,
      body: {
        error: {
          code: "RUNTIME_ENV_MISSING" as const,
          message: "Session signing is not configured on this deployment.",
          request_id: "req_view_as",
        },
      },
    };
  }

  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const now = options.now ?? Date.now();
  const expiresAt = new Date(now + VIEW_AS_TTL_MS).toISOString();

  const result = await handleAdminViewAs(
    createSupabaseAdminRepository(options.client),
    auth.context,
    userId,
    expiresAt,
  );

  if (!result.ok) return result;

  const target = result.body.target;
  const token = createViewAsToken(
    {
      auth_user_id: target.id,
      // The token is never exchanged with Google - these fields exist because a
      // session payload has them, and only the id is used to resolve reads.
      google_sub: "",
      email: target.email,
      display_name: target.display_name ?? target.email,
      avatar_url: target.avatar_url ?? undefined,
    },
    auth.context.user.id,
    options.sessionSecret,
    now,
  );

  return {
    ...result,
    headers: { "set-cookie": createViewAsCookie(token) },
  };
}

/** Leave the view. Clearing the cookie is the whole operation. */
export async function adminStopViewAsRoute() {
  return {
    ok: true as const,
    status: 200,
    headers: { "set-cookie": clearViewAsCookie() },
    body: { stopped: true },
  };
}

export async function adminGetSiteNoticeRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminGetSiteNotice(
    createSupabaseAdminRepository(options.client),
    createSupabaseSettingsRepository(options.client),
    auth.context,
  );
}

export async function adminSetSiteNoticeRoute(
  options: RouteOptions,
  body: {
    banner_message?: unknown;
    banner_level?: unknown;
    banner_ends_at?: unknown;
    maintenance_enabled?: unknown;
    maintenance_message?: unknown;
  },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const result = await handleAdminSetSiteNotice(
    createSupabaseAdminRepository(options.client),
    createSupabaseSettingsRepository(options.client),
    auth.context,
    body,
  );

  // The gate caches for 30s; drop it so the operator sees their own change take
  // effect on the very next request instead of wondering whether it saved.
  resetSiteNoticeCache();

  return result;
}

export async function adminReceiptScanUsageRoute(options: RouteOptions, days: string | undefined) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminReceiptScanUsage(createSupabaseAdminRepository(options.client), auth.context, days);
}

export async function adminStorageRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminStorage(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminListUsersRoute(options: RouteOptions, query: AdminListQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListUsers(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminUserDetailRoute(options: RouteOptions, userId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminUserDetail(createSupabaseAdminRepository(options.client), auth.context, userId);
}

export async function adminListGroupsRoute(options: RouteOptions, query: AdminGroupListQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListGroups(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminGroupDetailRoute(options: RouteOptions, groupId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminGroupDetail(createSupabaseAdminRepository(options.client), auth.context, groupId);
}

export async function adminListGroupExpensesRoute(
  options: RouteOptions,
  groupId: string,
  query: AdminExpenseListQuery,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListGroupExpenses(createSupabaseAdminRepository(options.client), auth.context, groupId, query);
}

export async function adminListAuditLogsRoute(options: RouteOptions, query: AdminAuditLogQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListAuditLogs(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminListFeedbackRoute(options: RouteOptions, query: AdminFeedbackListQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListFeedback(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminSetFeedbackStatusRoute(options: RouteOptions, feedbackId: string, status: string | undefined) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetFeedbackStatus(createSupabaseAdminRepository(options.client), auth.context, feedbackId, status);
}

export async function adminListErrorGroupsRoute(options: RouteOptions, query: AdminErrorListQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListErrorGroups(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminListErrorsRoute(options: RouteOptions, query: AdminErrorListQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListErrors(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminSetErrorGroupStatusRoute(
  options: RouteOptions,
  fingerprint: string,
  status: string | undefined,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetErrorGroupStatus(
    createSupabaseAdminRepository(options.client),
    auth.context,
    fingerprint,
    status,
  );
}

export async function adminSetUserDisabledRoute(options: RouteOptions, userId: string, disabled: boolean) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetUserDisabled(createSupabaseAdminRepository(options.client), auth.context, userId, disabled);
}

export async function adminSetGroupArchivedRoute(options: RouteOptions, groupId: string, archived: boolean) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetGroupArchived(createSupabaseAdminRepository(options.client), auth.context, groupId, archived);
}

export async function adminSetGroupDeletedRoute(options: RouteOptions, groupId: string, deleted: boolean) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetGroupDeleted(createSupabaseAdminRepository(options.client), auth.context, groupId, deleted);
}

export async function adminSetExpenseDeletedRoute(
  options: RouteOptions,
  groupId: string,
  expenseId: string,
  deleted: boolean,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetExpenseDeleted(
    createSupabaseAdminRepository(options.client),
    auth.context,
    groupId,
    expenseId,
    deleted,
  );
}

export async function adminUpdateExpenseMetaRoute(
  options: RouteOptions,
  groupId: string,
  expenseId: string,
  body: { title?: unknown; category?: unknown; expense_date?: unknown; note?: unknown },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminUpdateExpenseMeta(
    createSupabaseAdminRepository(options.client),
    auth.context,
    groupId,
    expenseId,
    body,
  );
}

export async function adminTransferGroupOwnerRoute(
  options: RouteOptions,
  groupId: string,
  memberId: string | undefined,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminTransferGroupOwner(
    createSupabaseAdminRepository(options.client),
    auth.context,
    groupId,
    memberId,
  );
}

export async function adminMergeUsersRoute(
  options: RouteOptions,
  sourceUserId: string,
  targetUserId: string | undefined,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminMergeUsers(
    createSupabaseAdminRepository(options.client),
    auth.context,
    sourceUserId,
    targetUserId,
  );
}

export async function adminExportUserRoute(options: RouteOptions, userId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminExportUser(createSupabaseAdminRepository(options.client), auth.context, userId);
}

export async function adminDeleteUserRoute(options: RouteOptions, userId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminDeleteUser(createSupabaseAdminRepository(options.client), auth.context, userId);
}

export async function adminSendNotificationRoute(options: RouteOptions, body: AdminSendNotificationBody) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSendNotification(createSupabaseAdminRepository(options.client), auth.context, body);
}

export async function adminListSentNotificationsRoute(options: RouteOptions, query: AdminListQuery) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListSentNotifications(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminDeleteNotificationBatchRoute(options: RouteOptions, batchId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminDeleteNotificationBatch(createSupabaseAdminRepository(options.client), auth.context, batchId);
}

export async function adminReplyFeedbackRoute(options: RouteOptions, feedbackId: string, message: unknown) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminReplyFeedback(createSupabaseAdminRepository(options.client), auth.context, feedbackId, message);
}

export async function adminGetCatalogRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminGetCatalog(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminSaveCategoryRoute(
  options: RouteOptions,
  key: string,
  body: { label?: unknown; color?: unknown; sort_order?: unknown; enabled?: unknown },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSaveCategory(createSupabaseAdminRepository(options.client), auth.context, key, body);
}

export async function adminSaveCurrencyRoute(
  options: RouteOptions,
  code: string,
  body: { label?: unknown; sort_order?: unknown; enabled?: unknown },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSaveCurrency(createSupabaseAdminRepository(options.client), auth.context, code, body);
}

export async function adminSetRateOverrideRoute(
  options: RouteOptions,
  body: { base?: unknown; quote?: unknown; rate?: unknown; note?: unknown },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminSetRateOverride(createSupabaseAdminRepository(options.client), auth.context, body);
}
