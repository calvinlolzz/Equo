import type { SupabaseQueryClient } from "../repositories/supabaseGroupRepository.js";

export type SupabaseQueryExecutor = <T>(operation: {
  mode: "one" | "maybeOne" | "exec";
  sql: string;
  params: unknown[];
}) => Promise<T>;

export function createSupabaseQueryClientAdapter(executor: SupabaseQueryExecutor): SupabaseQueryClient {
  return {
    one(sql, params) {
      return executor({ mode: "one", sql, params });
    },
    maybeOne(sql, params) {
      return executor({ mode: "maybeOne", sql, params });
    },
    async exec(sql, params) {
      await executor({ mode: "exec", sql, params });
    },
  };
}

type SupabaseRestOptions = {
  url: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
};

type RestRequest = {
  method: "GET" | "POST" | "PATCH";
  table: string;
  query?: string;
  body?: unknown;
  prefer?: string;
  returnRepresentation?: boolean;
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Every repository UPDATE carries `updated_at = now()`, but a PostgREST PATCH
 * only writes the columns present in its body and there is no database
 * trigger maintaining the column (see supabase/migrations - none of them
 * install one). So each translated PATCH has to set it explicitly, or
 * updated_at silently freezes at insert time - which is not cosmetic:
 * listGroups orders by groups.updated_at.
 */
function nowIso(): string {
  return new Date().toISOString();
}

function encodeFilter(value: unknown): string {
  return encodeURIComponent(String(value));
}

function firstRow<T>(rows: T[]): T {
  if (!rows[0]) {
    throw new Error("Supabase REST query returned no rows");
  }

  return rows[0];
}

type MembershipGroupRow = {
  id: string;
  group_id: string;
};

type RestGroupRow = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  archived_at?: string | null;
  cover_image_url?: string | null;
};

export function createSupabaseRestQueryClient(options: SupabaseRestOptions): SupabaseQueryClient {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.url.replace(/\/$/, "");

  function restHeaders(): Record<string, string> {
    return {
      apikey: options.serviceRoleKey,
      Authorization: `Bearer ${options.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
  }

  async function request<T>(request: RestRequest): Promise<T[]> {
    const headers = restHeaders();

    if (request.prefer || request.returnRepresentation) {
      headers.Prefer = [request.prefer, request.returnRepresentation ? "return=representation" : undefined]
        .filter(Boolean)
        .join(",");
    }

    const query = request.query ? `?${request.query}` : "";
    const response = await fetcher(`${baseUrl}/rest/v1/${request.table}${query}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });

    if (!response.ok) {
      throw new Error(`Supabase REST request failed: ${response.status}`);
    }

    if (!request.returnRepresentation && request.method !== "GET") {
      return [];
    }

    return response.json() as Promise<T[]>;
  }

  /**
   * Postgres RPC calls live at a different URL shape than table reads
   * (/rest/v1/rpc/<fn> vs /rest/v1/<table>) and the response is the raw
   * jsonb value the function returned - not an array of rows - so this is a
   * sibling of `request` rather than a table-shaped call through it.
   *
   * On failure the Postgres error message is re-thrown verbatim. The
   * transactional write functions (create_expense, accept_invite, ...) signal
   * business failures by raising sentinel messages - NOT_A_GROUP_MEMBER,
   * INVITE_EXPIRED, INVALID_MEMBER:<id> - which the route layer maps to API
   * error codes. Collapsing them into "request failed: 400" the way the
   * generic table path does would turn every one of them into a 500.
   */
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetcher(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: restHeaders(),
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const message = await response
        .json()
        .then((payload: unknown) => (payload as { message?: string } | null)?.message)
        .catch(() => undefined);

      throw new Error(message ?? `Supabase REST request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async function execute<T>(mode: "one" | "maybeOne" | "exec", sql: string, params: unknown[]): Promise<T> {
    const normalized = normalizeSql(sql);

    if (normalized.includes("insert into public.users")) {
      const rows = await request<T>({
        method: "POST",
        table: "users",
        query: "on_conflict=google_sub&select=id,google_sub,email,display_name,avatar_url,deleted_at",
        body: {
          id: params[0],
          google_sub: params[1],
          email: params[2],
          display_name: params[3],
          avatar_url: params[4],
        },
        prefer: "resolution=merge-duplicates",
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("insert into public.profiles")) {
      await request({
        method: "POST",
        table: "profiles",
        query: "on_conflict=id",
        body: {
          id: params[0],
          display_name: params[1],
          avatar_url: params[2],
          default_currency: "TWD",
        },
        prefer: "resolution=merge-duplicates",
      });
      return undefined as T;
    }

    // Auth-state probe for an already-resolved session user (findUserAuthState):
    // confirms the account has not been admin-disabled since the session token
    // was signed. Must be matched before the avatar branch below - both read
    // from public.users and only the selected column list tells them apart.
    if (normalized.includes("select id, deleted_at") && normalized.includes("from public.users")) {
      const rows = await request<T>({
        method: "GET",
        table: "users",
        query: `select=id,deleted_at&id=eq.${encodeFilter(params[0])}&limit=1`,
        returnRepresentation: true,
      });
      return (rows[0] ?? null) as T;
    }

    // Read-before-write lookup of the current avatar_url (updateUserAvatar,
    // PATCH /api/v1/me/avatar) - needed to know what to clean up from
    // storage once it's overwritten by the new upload.
    if (normalized.includes("select id, avatar_url") && normalized.includes("from public.users")) {
      const rows = await request<T>({
        method: "GET",
        table: "users",
        query: `select=id,avatar_url&id=eq.${encodeFilter(params[0])}&limit=1`,
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    // Self-scoped avatar update (PATCH /api/v1/me/avatar): must be matched
    // before the "insert into public.users" branch above's substring check
    // would never collide (this is an UPDATE), but keep it grouped here
    // since both touch the users table.
    if (normalized.includes("update public.users") && normalized.includes("set avatar_url = $1")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "users",
        query: `id=eq.${encodeFilter(params[1])}&select=avatar_url`,
        body: { avatar_url: params[0], updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.profiles") && normalized.includes("set avatar_url = $1")) {
      await request({
        method: "PATCH",
        table: "profiles",
        query: `id=eq.${encodeFilter(params[1])}`,
        body: { avatar_url: params[0], updated_at: nowIso() },
      });
      return undefined as T;
    }

    // Admin console reporting RPCs (see supabaseAdminRepository.ts). The
    // raw jsonb the function returns IS the repository's record shape, so
    // each branch forwards params positionally and returns the value as-is.
    if (normalized.includes("select public.admin_console_role(")) {
      const role = await rpc<unknown>("admin_console_role", { p_user_id: params[0] });
      return (role ?? null) as T;
    }

    if (normalized.includes("select public.admin_console_overview(")) {
      return (await rpc<unknown>("admin_console_overview", {})) as T;
    }

    if (normalized.includes("select public.admin_console_users(")) {
      return (await rpc<unknown>("admin_console_users", {
        p_search: params[0],
        p_limit: params[1],
        p_offset: params[2],
      })) as T;
    }

    if (normalized.includes("select public.admin_console_user_detail(")) {
      const detail = await rpc<unknown>("admin_console_user_detail", { p_user_id: params[0] });
      return (detail ?? null) as T;
    }

    if (normalized.includes("select public.admin_console_groups(")) {
      return (await rpc<unknown>("admin_console_groups", {
        p_search: params[0],
        p_limit: params[1],
        p_offset: params[2],
        p_filter: params[3],
      })) as T;
    }

    if (normalized.includes("select public.admin_console_set_user_disabled(")) {
      const result = await rpc<unknown>("admin_console_set_user_disabled", {
        p_actor: params[0],
        p_actor_email: params[1],
        p_user_id: params[2],
        p_disabled: params[3],
      });
      return (result ?? null) as T;
    }

    if (normalized.includes("select public.admin_console_set_group_archived(")) {
      const result = await rpc<unknown>("admin_console_set_group_archived", {
        p_actor: params[0],
        p_actor_email: params[1],
        p_group_id: params[2],
        p_archived: params[3],
      });
      return (result ?? null) as T;
    }

    if (normalized.includes("insert into public.app_feedback")) {
      const rows = await request<T>({
        method: "POST",
        table: "app_feedback",
        query: "select=id",
        body: {
          user_id: params[0],
          type: params[1],
          message: params[2],
          contact: params[3],
          page: params[4],
        },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("insert into public.app_error_logs")) {
      await request({
        method: "POST",
        table: "app_error_logs",
        body: {
          user_id: params[0],
          source: params[1],
          message: params[2],
          context: params[3],
          page: params[4],
        },
      });
      return undefined as T;
    }

    if (normalized.includes("select public.admin_console_feedback(")) {
      return (await rpc<unknown>("admin_console_feedback", {
        p_limit: params[0],
        p_offset: params[1],
        p_status: params[2],
      })) as T;
    }

    if (normalized.includes("select public.admin_console_set_feedback_status(")) {
      const result = await rpc<unknown>("admin_console_set_feedback_status", {
        p_actor: params[0],
        p_actor_email: params[1],
        p_feedback_id: params[2],
        p_status: params[3],
      });
      return (result ?? null) as T;
    }

    if (normalized.includes("select public.admin_console_errors(")) {
      return (await rpc<unknown>("admin_console_errors", {
        p_limit: params[0],
        p_offset: params[1],
      })) as T;
    }

    if (normalized.includes("select public.admin_console_audit_logs(")) {
      return (await rpc<unknown>("admin_console_audit_logs", {
        p_limit: params[0],
        p_offset: params[1],
      })) as T;
    }

    if (normalized.includes("select public.admin_console_set_group_deleted(")) {
      const result = await rpc<unknown>("admin_console_set_group_deleted", {
        p_actor: params[0],
        p_actor_email: params[1],
        p_group_id: params[2],
        p_deleted: params[3],
      });
      return (result ?? null) as T;
    }

    // Transactional write RPCs (see
    // supabase/migrations/20260714100000_transactional_write_rpcs.sql). Each one
    // replaces a sequence of PostgREST calls that had no transaction around it:
    // the whole point is that they are a single call, so there is nothing here
    // to stitch together - forward the params and hand back the jsonb.
    if (normalized.includes("select public.create_expense(")) {
      return (await rpc<unknown>("create_expense", {
        p_group_id: params[0],
        p_user_id: params[1],
        p_payload: params[2],
      })) as T;
    }

    if (normalized.includes("select public.replace_expense(")) {
      return (await rpc<unknown>("replace_expense", {
        p_group_id: params[0],
        p_user_id: params[1],
        p_expense_id: params[2],
        p_payload: params[3],
      })) as T;
    }

    if (normalized.includes("select public.soft_delete_expense(")) {
      return (await rpc<unknown>("soft_delete_expense", {
        p_group_id: params[0],
        p_user_id: params[1],
        p_expense_id: params[2],
        p_client_request_id: params[3],
      })) as T;
    }

    if (normalized.includes("select public.accept_invite(")) {
      const result = await rpc<unknown>("accept_invite", {
        p_token_hash: params[0],
        p_user_id: params[1],
        p_display_name: params[2],
        p_claim_member_id: params[3],
        p_client_request_id: params[4],
      });
      return (result ?? null) as T;
    }

    if (normalized.includes("select public.create_settlement(")) {
      return (await rpc<unknown>("create_settlement", {
        p_group_id: params[0],
        p_user_id: params[1],
        p_settlement_version: params[2],
        p_calculated_version: params[3],
        p_transfers: params[4],
      })) as T;
    }

    if (normalized.includes("select public.get_group_detail(")) {
      const detail = await rpc<unknown>("get_group_detail", {
        p_group_id: params[0],
        p_user_id: params[1],
        p_expense_limit: params[2],
      });
      return (detail ?? null) as T;
    }

    if (normalized.includes("insert into public.groups")) {
      const rows = await request<T>({
        method: "POST",
        table: "groups",
        query: "select=id,name,currency,owner_member_id,cover_image_url",
        body: { name: params[0], currency: params[1], owner_id: params[2], cover_image_url: params[3] ?? null },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (
      normalized.includes("from public.groups g") &&
      normalized.includes("join public.group_members gm") &&
      normalized.includes("g.archived_at is not null")
    ) {
      const membershipRows = await request<MembershipGroupRow>({
        method: "GET",
        table: "group_members",
        query: `select=id,group_id&user_id=eq.${encodeFilter(params[0])}&status=eq.active&limit=50`,
        returnRepresentation: true,
      });
      const callerMemberIdByGroupId = new Map(membershipRows.map((row) => [row.group_id, row.id]));
      const groupIds = [...new Set(membershipRows.map((row) => row.group_id).filter(Boolean))];

      if (groupIds.length === 0) {
        return [] as T;
      }

      const groups = await request<RestGroupRow>({
        method: "GET",
        table: "groups",
        query: `select=id,name,currency,owner_member_id,archived_at,cover_image_url&id=in.(${groupIds.map(encodeFilter).join(",")})&archived_at=not.is.null&deleted_at=is.null&order=updated_at.desc,created_at.desc&limit=50`,
        returnRepresentation: true,
      });

      return groups.map((group) => ({
        ...group,
        caller_member_id: callerMemberIdByGroupId.get(group.id) ?? null,
      })) as T;
    }

    if (normalized.includes("from public.groups g") && normalized.includes("join public.group_members gm")) {
      const membershipRows = await request<MembershipGroupRow>({
        method: "GET",
        table: "group_members",
        query: `select=group_id&user_id=eq.${encodeFilter(params[0])}&status=eq.active&limit=50`,
        returnRepresentation: true,
      });
      const groupIds = [...new Set(membershipRows.map((row) => row.group_id).filter(Boolean))];

      if (groupIds.length === 0) {
        return [] as T;
      }

      return request<RestGroupRow>({
        method: "GET",
        table: "groups",
        query: `select=id,name,currency,owner_member_id,cover_image_url&id=in.(${groupIds.map(encodeFilter).join(",")})&archived_at=is.null&deleted_at=is.null&order=updated_at.desc,created_at.desc&limit=50`,
        returnRepresentation: true,
      }) as T;
    }

    if (normalized.includes("insert into public.group_members")) {
      const isVirtualMemberInsert = normalized.includes("values ($1, null, $2");
      const rows = await request<T>({
        method: "POST",
        table: "group_members",
        query: "select=id,group_id,user_id,display_name,role,status",
        body: {
          group_id: params[0],
          user_id: isVirtualMemberInsert ? null : (params[1] ?? null),
          display_name: isVirtualMemberInsert ? params[1] : params[2],
          role: normalized.includes("'owner'") ? "owner" : "member",
          status: "active",
          claimed_at: normalized.includes("claimed_at") ? new Date().toISOString() : null,
        },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set owner_member_id = $1")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[1])}&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { owner_member_id: params[0], updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set name = $1")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[2])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body:
          params[1] == null
            ? { name: params[0], updated_at: nowIso() }
            : { name: params[0], cover_image_url: params[1], updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set archived_at = now()")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[0])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { archived_at: nowIso(), updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set archived_at = null")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[0])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { archived_at: null, updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set deleted_at = now()")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[0])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { deleted_at: nowIso(), updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("from public.group_members") && normalized.includes("where group_id = $1 and user_id = $2")) {
      const rows = await request<T>({
        method: "GET",
        table: "group_members",
        query: `select=id,group_id,user_id,display_name,role,status&group_id=eq.${encodeFilter(params[0])}&user_id=eq.${encodeFilter(params[1])}&status=eq.active&limit=1`,
        returnRepresentation: true,
      });
      return (mode === "maybeOne" ? (rows[0] ?? null) : firstRow(rows)) as T;
    }

    if (normalized.includes("from public.group_members") && normalized.includes("where group_id = $1 and status = 'active'")) {
      return request<T>({
        method: "GET",
        table: "group_members",
        query: `select=id,group_id,user_id,display_name,role,status&group_id=eq.${encodeFilter(params[0])}&status=eq.active&order=role.desc,created_at.asc`,
        returnRepresentation: true,
      }) as T;
    }

    if (normalized.includes("from public.group_members") && normalized.includes("where group_id = $1 and id = $2")) {
      const rows = await request<T>({
        method: "GET",
        table: "group_members",
        query: `select=id,group_id,user_id,display_name,role,status&group_id=eq.${encodeFilter(params[0])}&id=eq.${encodeFilter(params[1])}&limit=1`,
        returnRepresentation: true,
      });
      return (mode === "maybeOne" ? (rows[0] ?? null) : firstRow(rows)) as T;
    }

    if (normalized.includes("insert into public.invites")) {
      const rows = await request<T>({
        method: "POST",
        table: "invites",
        query: "select=id,group_id,token_hash,max_uses,use_count,expires_at",
        body: {
          group_id: params[0],
          token_hash: params[1],
          max_uses: params[2],
          expires_at: params[3],
          created_by_member_id: params[4],
        },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("from public.groups") && normalized.includes("where id = $1")) {
      const rows = await request<T>({
        method: "GET",
        table: "groups",
        query: `select=id,name,currency,owner_member_id,cover_image_url&id=eq.${encodeFilter(params[0])}&deleted_at=is.null&limit=1`,
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    // Rename a virtual member: must be matched before the generic
    // "update public.group_members" claim branch below, which would
    // otherwise swallow this SQL with the wrong body/filters.
    if (normalized.includes("update public.group_members") && normalized.includes("set display_name = $1")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "group_members",
        query: `id=eq.${encodeFilter(params[1])}&group_id=eq.${encodeFilter(params[2])}&user_id=is.null&status=eq.active&select=id,group_id,user_id,display_name,role,status`,
        body: { display_name: params[0], updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    // Soft-remove a virtual member: same ordering constraint as the rename
    // branch above.
    if (normalized.includes("update public.group_members") && normalized.includes("set status = 'removed'")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "group_members",
        query: `id=eq.${encodeFilter(params[0])}&group_id=eq.${encodeFilter(params[1])}&user_id=is.null&status=eq.active&select=id,group_id,user_id,display_name,role,status`,
        body: { status: "removed", updated_at: nowIso() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("insert into public.client_requests")) {
      await request({
        method: "POST",
        table: "client_requests",
        query: "on_conflict=group_id,client_request_id",
        body: { group_id: params[0], client_request_id: params[1], resource_id: params[2] },
        prefer: "resolution=ignore-duplicates",
      });
      return undefined as T;
    }

    if (normalized.includes("from public.expense_payments") && normalized.includes("expense_id = any($1)")) {
      const expenseIds = params[0] as string[];
      return request<T>({
        method: "GET",
        table: "expense_payments",
        query: `select=expense_id,payer_member_id,amount_minor,currency&expense_id=in.(${expenseIds.map(encodeFilter).join(",")})`,
        returnRepresentation: true,
      }) as T;
    }

    if (normalized.includes("from public.expense_shares") && normalized.includes("expense_id = any($1)")) {
      const expenseIds = params[0] as string[];
      return request<T>({
        method: "GET",
        table: "expense_shares",
        query: `select=expense_id,member_id,share_type,share_value,amount_minor&expense_id=in.(${expenseIds.map(encodeFilter).join(",")})`,
        returnRepresentation: true,
      }) as T;
    }

    // Cursor page (listExpensesPage with a cursor): must be matched before
    // the plain "list all expenses" branch below, since both share the
    // "from public.expenses" + "order by expense_date" substrings - the
    // cursor comparison is the only distinguishing marker.
    if (normalized.includes("from public.expenses") && normalized.includes("(expense_date, created_at) < ($2, $3)")) {
      const [groupId, beforeDate, beforeCreatedAt, limit] = params as [string, string, string, number];
      return request<T>({
        method: "GET",
        table: "expenses",
        query: `select=id,group_id,title,kind,category,amount_minor,currency,expense_date,note,transfer_to_member_id,created_at,version,client_request_id,image_url&group_id=eq.${encodeFilter(groupId)}&deleted_at=is.null&or=(expense_date.lt.${encodeFilter(beforeDate)},and(expense_date.eq.${encodeFilter(beforeDate)},created_at.lt.${encodeFilter(beforeCreatedAt)}))&order=expense_date.desc,created_at.desc&limit=${encodeFilter(limit)}`,
        returnRepresentation: true,
      }) as T;
    }

    // Un-cursored page (listExpensesPage's first page, limit only) and the
    // plain "list all expenses" query (listExpenses) share this shape aside
    // from the limit clause; both are satisfied by the same GET with an
    // optional limit param.
    if (normalized.includes("from public.expenses") && normalized.includes("order by expense_date")) {
      const hasLimit = normalized.includes("limit $2");
      const limitQuery = hasLimit ? `&limit=${encodeFilter(params[1] as number)}` : "";
      return request<T>({
        method: "GET",
        table: "expenses",
        query: `select=id,group_id,title,kind,category,amount_minor,currency,expense_date,note,transfer_to_member_id,created_at,version,client_request_id,image_url&group_id=eq.${encodeFilter(params[0])}&deleted_at=is.null&order=expense_date.desc,created_at.desc${limitQuery}`,
        returnRepresentation: true,
      }) as T;
    }

    // Single-member balance lookup (member-removal gate): must be matched
    // before the whole-group balances branch below, whose check only looks
    // at the table name.
    if (normalized.includes("from public.group_member_balances") && normalized.includes("member_id = $2")) {
      const rows = await request<T>({
        method: "GET",
        table: "group_member_balances",
        query: `select=balance_minor&group_id=eq.${encodeFilter(params[0])}&member_id=eq.${encodeFilter(params[1])}&limit=1`,
        returnRepresentation: true,
      });
      return (mode === "maybeOne" ? (rows[0] ?? null) : firstRow(rows)) as T;
    }

    if (normalized.includes("from public.group_member_balances")) {
      type BalanceRow = { member_id: string; balance_minor: number; currency: string };
      const rows = await request<BalanceRow>({
        method: "GET",
        table: "group_member_balances",
        query: `select=member_id,balance_minor,currency&group_id=eq.${encodeFilter(params[0])}`,
        returnRepresentation: true,
      });
      return rows.map((row) => ({
        memberId: row.member_id,
        balance: {
          amount_minor: row.balance_minor,
          currency: row.currency,
        },
      })) as T;
    }

    if (normalized.includes("from public.settlements")) {
      const rows = await request<T>({
        method: "GET",
        table: "settlements",
        query: `select=id,group_id,settlement_version,calculated_version,status&group_id=eq.${encodeFilter(params[0])}&id=eq.${encodeFilter(params[1])}&limit=1`,
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.settlements")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "settlements",
        query: `group_id=eq.${encodeFilter(params[0])}&id=eq.${encodeFilter(params[1])}&settlement_version=eq.${encodeFilter(params[2])}&select=id,group_id,settlement_version,calculated_version,status`,
        body: { status: "confirmed", confirmed_at: new Date().toISOString() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    throw new Error(`Unsupported Supabase REST SQL operation: ${normalized}`);
  }

  return {
    one(sql, params) {
      return execute("one", sql, params);
    },
    maybeOne(sql, params) {
      return execute("maybeOne", sql, params);
    },
    async exec(sql, params) {
      await execute("exec", sql, params);
    },
  };
}

export function createUnavailableSupabaseQueryClient(): SupabaseQueryClient {
  const unavailable = async () => {
    throw new Error("Supabase client adapter is not configured");
  };

  return {
    one: unavailable,
    maybeOne: unavailable,
    exec: unavailable,
  };
}
