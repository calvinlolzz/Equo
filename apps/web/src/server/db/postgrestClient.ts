/**
 * The database client the repositories talk to.
 *
 * What this replaces: repositories used to emit SQL strings that were never
 * executed. A translator (runtime/supabaseQueryClient.ts) took each string,
 * substring-matched it - `normalized.includes("update public.groups")` - and
 * hand-wrote an equivalent PostgREST call. There was no database or query
 * parser anywhere in the loop, so the SQL was fiction: a where-clause, an
 * `order by`, a `returning` list, an `updated_at = now()` could all be present
 * in the repository and simply absent from what production actually ran.
 *
 * Nothing caught it. TypeScript couldn't - the two sides were joined by a raw
 * string at runtime. The repository unit tests couldn't - they ran against a
 * hand-written fake, not the translator. That gap shipped real bugs: invite
 * expiry was enforced in the SQL and nowhere in the translated call, so expired
 * invites kept working; every UPDATE claimed `updated_at = now()` and none of
 * them wrote it, so groups.updated_at froze at insert time and the groups list
 * silently stopped being sorted by recent activity.
 *
 * So the fiction is gone. A repository now says exactly what the database will
 * do - one call, one HTTP request, checked by the type system - and there is no
 * second implementation of the same query to drift away from the first.
 *
 * Everything runs as service_role: the browser holds no Postgres role, RLS is
 * closed, and this process is the only thing that talks to the database.
 */
export type PostgrestClient = {
  /** GET /rest/v1/<table>?<query> */
  select<T>(table: string, query: string): Promise<T[]>;
  /** POST /rest/v1/<table>?<query>, returning the inserted rows. */
  insert<T>(table: string, body: unknown, options?: InsertOptions): Promise<T[]>;
  /** PATCH /rest/v1/<table>?<query>, returning the updated rows. */
  update<T>(table: string, query: string, body: unknown): Promise<T[]>;
  /**
   * POST /rest/v1/rpc/<fn>. Returns the function's jsonb value as-is (not an
   * array of rows - RPCs return a scalar).
   */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
};

export type InsertOptions = {
  query?: string;
  /** PostgREST `Prefer:` conflict handling, e.g. "resolution=merge-duplicates". */
  prefer?: string;
};

// ---------------------------------------------------------------------------
// Query fragments. PostgREST filters are URL query params; these keep the
// encoding in one place instead of scattering template literals through the
// repositories.
// ---------------------------------------------------------------------------

function encodeValue(value: unknown): string {
  return encodeURIComponent(String(value));
}

/** Join fragments into a PostgREST query string, dropping empty ones. */
export function query(...parts: Array<string | undefined | null | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join("&");
}

export function columns(list: string): string {
  return `select=${list}`;
}

export function eq(column: string, value: unknown): string {
  return `${column}=eq.${encodeValue(value)}`;
}

export function isNull(column: string): string {
  return `${column}=is.null`;
}

export function isNotNull(column: string): string {
  return `${column}=not.is.null`;
}

export function inList(column: string, values: readonly unknown[]): string {
  return `${column}=in.(${values.map(encodeValue).join(",")})`;
}

export function lessThan(column: string, value: unknown): string {
  return `${column}=lt.${encodeValue(value)}`;
}

/**
 * The keyset-pagination predicate `(expense_date, created_at) < ($1, $2)`.
 * PostgREST has no row-value comparison, so it expands to the equivalent
 * disjunction. Kept here, named, because writing it inline is easy to get
 * subtly wrong (an `expense_date.lte` instead of `.lt` silently repeats a row
 * on every page boundary).
 */
export function beforeKeyset(
  dateColumn: string,
  tieBreakColumn: string,
  beforeDate: string,
  beforeTieBreak: string,
): string {
  return (
    `or=(${dateColumn}.lt.${encodeValue(beforeDate)},` +
    `and(${dateColumn}.eq.${encodeValue(beforeDate)},${tieBreakColumn}.lt.${encodeValue(beforeTieBreak)}))`
  );
}

export function order(spec: string): string {
  return `order=${spec}`;
}

export function limit(count: number): string {
  return `limit=${encodeValue(count)}`;
}

export function onConflict(target: string): string {
  return `on_conflict=${target}`;
}

// ---------------------------------------------------------------------------

export type PostgrestOptions = {
  url: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
};

export function createPostgrestClient(options: PostgrestOptions): PostgrestClient {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.url.replace(/\/$/, "");

  function headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: options.serviceRoleKey,
      Authorization: `Bearer ${options.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function send<T>(
    path: string,
    init: { method: string; body?: unknown; prefer?: string },
  ): Promise<T> {
    const response = await fetcher(`${baseUrl}/rest/v1/${path}`, {
      method: init.method,
      headers: headers(init.prefer ? { Prefer: init.prefer } : undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (!response.ok) {
      // A Postgres function signals a business failure by raising a sentinel
      // message (NOT_A_GROUP_MEMBER, INVITE_EXPIRED, INVALID_MEMBER:<id> - see
      // supabase/migrations/20260714100000_transactional_write_rpcs.sql), and
      // PostgREST puts it in the error body. Losing it here would turn every
      // one of those into an opaque 500.
      const message = await response
        .json()
        .then((payload: unknown) => (payload as { message?: string } | null)?.message)
        .catch(() => undefined);

      throw new Error(message ?? `Supabase REST request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    select(table, queryString) {
      return send(`${table}${queryString ? `?${queryString}` : ""}`, { method: "GET" });
    },

    insert(table, body, insertOptions) {
      const prefer = [insertOptions?.prefer, "return=representation"].filter(Boolean).join(",");
      return send(`${table}${insertOptions?.query ? `?${insertOptions.query}` : ""}`, {
        method: "POST",
        body,
        prefer,
      });
    },

    update(table, queryString, body) {
      return send(`${table}${queryString ? `?${queryString}` : ""}`, {
        method: "PATCH",
        body,
        prefer: "return=representation",
      });
    },

    rpc(fn, args) {
      return send(`rpc/${fn}`, { method: "POST", body: args });
    },
  };
}

/**
 * Stand-in used when the runtime env is incomplete (see runtimeEnv.ts). Every
 * call fails loudly rather than silently reading from nowhere.
 */
export function createUnavailablePostgrestClient(): PostgrestClient {
  const unavailable = async (): Promise<never> => {
    throw new Error("Supabase client is not configured");
  };

  return {
    select: unavailable,
    insert: unavailable,
    update: unavailable,
    rpc: unavailable,
  };
}

/** The single row a query is expected to return; throws when there is none. */
export function requireRow<T>(rows: T[], what: string): T {
  const row = rows[0];

  if (!row) {
    throw new Error(`Expected a ${what} row, got none`);
  }

  return row;
}

/** The first row, or null when the query matched nothing. */
export function optionalRow<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}
