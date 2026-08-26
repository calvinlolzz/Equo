export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRuntimeRequest = {
  method: HttpMethod;
  path: string;
  headers: Record<string, string | undefined>;
  query?: Record<string, string | string[] | undefined>;
  json?: unknown;
};

export type HttpRuntimeResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export function getBearerToken(request: HttpRuntimeRequest): string {
  const authorization = request.headers.authorization ?? request.headers.Authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return "";
  }

  return authorization.slice("Bearer ".length).trim();
}

export function getCookieValue(request: HttpRuntimeRequest, name: string): string {
  const cookie = request.headers.cookie ?? request.headers.Cookie;

  if (!cookie) {
    return "";
  }

  const pair = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}

export function getAuthToken(request: HttpRuntimeRequest): string {
  // equo_view_as wins while it is set, and that is the entire mechanism: every
  // read path resolves the caller from this one function, so preferring the
  // view-as token here makes the whole app render as the target user without a
  // single route knowing why. It is a separate cookie so the admin's own
  // session is still there, untouched, when they stop looking.
  //
  // The bearer token still wins over both - it is only used by tests and tools,
  // and a caller who passes one explicitly means it.
  return getBearerToken(request) || getCookieValue(request, "equo_view_as") || getCookieValue(request, "equo_session");
}

/**
 * The caller's address, for rate-limit buckets.
 *
 * Reads the FIRST entry of x-forwarded-for. On Vercel the platform edge sets
 * that header itself and any client-supplied value is replaced, so the leading
 * entry is the real peer rather than something a caller can choose. Empty when
 * the header is absent (local dev, tests) - never fabricate an address, because
 * a placeholder would put every anonymous caller in one shared bucket and let
 * one of them lock out the rest.
 */
export function getClientIp(request: HttpRuntimeRequest): string {
  const forwarded = request.headers["x-forwarded-for"] ?? request.headers["X-Forwarded-For"];
  if (!forwarded) return "";

  return forwarded.split(",")[0]?.trim() ?? "";
}
