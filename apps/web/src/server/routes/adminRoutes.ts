import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseAdminRepository } from "../repositories/supabaseAdminRepository.js";
import {
  handleAdminGroupDetail,
  handleAdminHealth,
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
} from "../handlers/admin.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
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

export async function adminTrendsRoute(options: RouteOptions, days: string | undefined) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminTrends(createSupabaseAdminRepository(options.client), auth.context, days);
}

export async function adminHealthRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminHealth(createSupabaseAdminRepository(options.client), auth.context);
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
