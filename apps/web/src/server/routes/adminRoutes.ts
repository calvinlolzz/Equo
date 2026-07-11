import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
import { createSupabaseAdminRepository } from "../repositories/supabaseAdminRepository.js";
import {
  upsertUserByGoogleIdentity,
  type SupabaseQueryClient,
} from "../repositories/supabaseGroupRepository.js";
import {
  handleAdminListGroups,
  handleAdminListUsers,
  handleAdminMe,
  handleAdminOverview,
  handleAdminUserDetail,
  type AdminListQuery,
} from "../handlers/admin.js";

type RouteOptions = {
  client: SupabaseQueryClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

async function buildRouteContext(options: RouteOptions) {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier);
  return requireAuthenticatedUser(identity, (googleIdentity) =>
    upsertUserByGoogleIdentity(options.client, googleIdentity),
  );
}

export async function adminMeRoute(options: RouteOptions) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminMe(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminOverviewRoute(options: RouteOptions) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminOverview(createSupabaseAdminRepository(options.client), auth.context);
}

export async function adminListUsersRoute(options: RouteOptions, query: AdminListQuery) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListUsers(createSupabaseAdminRepository(options.client), auth.context, query);
}

export async function adminUserDetailRoute(options: RouteOptions, userId: string) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminUserDetail(createSupabaseAdminRepository(options.client), auth.context, userId);
}

export async function adminListGroupsRoute(options: RouteOptions, query: AdminListQuery) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAdminListGroups(createSupabaseAdminRepository(options.client), auth.context, query);
}
