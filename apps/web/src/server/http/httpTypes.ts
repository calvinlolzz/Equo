export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

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
  return getBearerToken(request) || getCookieValue(request, "equo_session");
}
