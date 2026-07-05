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

  async function request<T>(request: RestRequest): Promise<T[]> {
    const headers: Record<string, string> = {
      apikey: options.serviceRoleKey,
      Authorization: `Bearer ${options.serviceRoleKey}`,
      "Content-Type": "application/json",
    };

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

  async function execute<T>(mode: "one" | "maybeOne" | "exec", sql: string, params: unknown[]): Promise<T> {
    const normalized = normalizeSql(sql);

    if (normalized.includes("insert into public.users")) {
      const rows = await request<T>({
        method: "POST",
        table: "users",
        query: "on_conflict=google_sub&select=id,google_sub,email,display_name",
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
        query: `select=id,name,currency,owner_member_id,archived_at,cover_image_url&id=in.(${groupIds.map(encodeFilter).join(",")})&archived_at=not.is.null&deleted_at=is.null`,
        returnRepresentation: true,
      }) as T;
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
        query: `select=id,name,currency,owner_member_id,cover_image_url&id=in.(${groupIds.map(encodeFilter).join(",")})&archived_at=is.null&deleted_at=is.null`,
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
        body: { owner_member_id: params[0] },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set name = $1")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[2])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: params[1] == null ? { name: params[0] } : { name: params[0], cover_image_url: params[1] },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set archived_at = now()")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[0])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { archived_at: new Date().toISOString() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set archived_at = null")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[0])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { archived_at: null },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.groups") && normalized.includes("set deleted_at = now()")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "groups",
        query: `id=eq.${encodeFilter(params[0])}&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url`,
        body: { deleted_at: new Date().toISOString() },
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

    if (normalized.includes("from public.invites")) {
      const rows = await request<Array<T & { revoked_at?: string | null; use_count: number; max_uses: number }>[number]>({
        method: "GET",
        table: "invites",
        query: `select=id,group_id,token_hash,max_uses,use_count,expires_at,revoked_at&token_hash=eq.${encodeFilter(params[0])}&limit=1`,
        returnRepresentation: true,
      });
      const invite = rows.find((row) => !row.revoked_at && row.use_count < row.max_uses) ?? null;
      return (mode === "maybeOne" ? invite : firstRow(invite ? [invite] : [])) as T;
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

    if (normalized.includes("update public.group_members")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "group_members",
        query: `id=eq.${encodeFilter(params[2])}&group_id=eq.${encodeFilter(params[3])}&user_id=is.null&status=eq.active&select=id,group_id,user_id,display_name,role,status`,
        body: { user_id: params[0], display_name: params[1], claimed_at: new Date().toISOString() },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("update public.invites")) {
      await request({
        method: "PATCH",
        table: "invites",
        query: `id=eq.${encodeFilter(params[0])}`,
        body: { use_count: params[1] },
      });
      return undefined as T;
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

    if (normalized.includes("insert into public.expenses")) {
      const rows = await request<T>({
        method: "POST",
        table: "expenses",
        query: "select=id,group_id,title,kind,category,amount_minor,currency,expense_date,created_at,version,client_request_id,image_url",
        body: {
          group_id: params[0],
          created_by_member_id: params[1],
          title: params[2],
          kind: params[3],
          category: params[4],
          amount_minor: params[5],
          currency: params[6],
          expense_date: params[7],
          note: params[8],
          transfer_to_member_id: params[9],
          client_request_id: params[10],
          image_url: params[11] ?? null,
        },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("insert into public.expense_payments")) {
      await request({
        method: "POST",
        table: "expense_payments",
        body: {
          expense_id: params[0],
          payer_member_id: params[1],
          amount_minor: params[2],
          currency: params[3],
        },
      });
      return undefined as T;
    }

    if (normalized.includes("insert into public.expense_shares")) {
      await request({
        method: "POST",
        table: "expense_shares",
        body: {
          expense_id: params[0],
          member_id: params[1],
          share_type: params[2],
          share_value: params[3],
          amount_minor: params[4],
        },
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

    if (normalized.includes("from public.expenses") && normalized.includes("order by expense_date")) {
      return request<T>({
        method: "GET",
        table: "expenses",
        query: `select=id,group_id,title,kind,category,amount_minor,currency,expense_date,note,transfer_to_member_id,created_at,version,client_request_id,image_url&group_id=eq.${encodeFilter(params[0])}&deleted_at=is.null&order=expense_date.desc,created_at.desc`,
        returnRepresentation: true,
      }) as T;
    }

    if (normalized.includes("update public.expenses")) {
      const rows = await request<T>({
        method: "PATCH",
        table: "expenses",
        query: `group_id=eq.${encodeFilter(params[0])}&id=eq.${encodeFilter(params[1])}&deleted_at=is.null&select=id,group_id,title,kind,category,amount_minor,currency,expense_date,created_at,version,client_request_id`,
        body: { deleted_at: new Date().toISOString() },
        returnRepresentation: true,
      });
      return firstRow(rows);
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

    if (normalized.includes("insert into public.settlements")) {
      const rows = await request<T>({
        method: "POST",
        table: "settlements",
        query: "select=id,group_id,settlement_version,calculated_version,status",
        body: {
          group_id: params[0],
          settlement_version: params[1],
          calculated_version: params[2],
          status: "draft",
          created_by_member_id: params[3],
        },
        returnRepresentation: true,
      });
      return firstRow(rows);
    }

    if (normalized.includes("insert into public.settlement_transfers")) {
      await request({
        method: "POST",
        table: "settlement_transfers",
        body: {
          settlement_id: params[0],
          from_member_id: params[1],
          to_member_id: params[2],
          amount_minor: params[3],
          currency: params[4],
        },
      });
      return undefined as T;
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
