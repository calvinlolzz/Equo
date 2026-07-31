import type { HttpMethod } from "../apps/web/src/server/http/httpTypes.js";

type VercelRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function handleV1Request(request: VercelRequest, response: VercelResponse) {
  try {
    await routeV1Request(request, response);
  } catch (error) {
    // Last-resort guard for failures that happen before the HTTP runtime's
    // own try/catch can run - dynamic import failures, env parsing, runtime
    // construction. Mirrors the runtime's INTERNAL_ERROR shape so the client
    // never sees a raw platform error string, and logs the real cause with a
    // correlation id server-side.
    const request_id = `req_err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    console.error(`[${request_id}] v1 handler setup failed:`, error);
    try {
      response.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred.",
          request_id,
        },
      });
    } catch (writeError) {
      // The failure happened after the response had already started (rare -
      // e.g. a non-serializable body). Nothing left to send; just log it so
      // the original cause above still stands on its own.
      console.error(`[${request_id}] failed to write error response:`, writeError);
    }
  }
}

async function routeV1Request(request: VercelRequest, response: VercelResponse) {
  const [
    { createHttpRuntime },
    { createGoogleTokenVerifier },
    { missingRuntimeEnv, readRuntimeEnv, readVapidKeys },
    { createSupabaseAccessTokenVerifier },
    { createPostgrestClient },
    { createSupabaseStorageClient },
  ] = await Promise.all([
    import("../apps/web/src/server/http/runtime.js"),
    import("../apps/web/src/server/runtime/googleTokenVerifier.js"),
    import("../apps/web/src/server/runtime/runtimeEnv.js"),
    import("../apps/web/src/server/runtime/supabaseAuthVerifier.js"),
    import("../apps/web/src/server/db/postgrestClient.js"),
    import("../apps/web/src/server/runtime/supabaseStorageClient.js"),
  ]);

  const runtimeEnv = readRuntimeEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    SESSION_SECRET: process.env.SESSION_SECRET,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  });
  const missing = missingRuntimeEnv(runtimeEnv);

  if (missing.length > 0) {
    response.status(503).json({
      error: {
        code: "RUNTIME_ENV_MISSING",
        message: `Missing runtime env: ${missing.join(", ")}`,
        request_id: "req_runtime_env",
      },
    });
    return;
  }

  const requiredEnv = {
    SUPABASE_URL: runtimeEnv.SUPABASE_URL as string,
    SUPABASE_ANON_KEY: runtimeEnv.SUPABASE_ANON_KEY as string,
    SUPABASE_SERVICE_ROLE_KEY: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY as string,
    GOOGLE_OAUTH_CLIENT_ID: runtimeEnv.GOOGLE_OAUTH_CLIENT_ID as string,
    SESSION_SECRET: runtimeEnv.SESSION_SECRET as string,
  };
  const runtime = createHttpRuntime({
    client: createPostgrestClient({
      url: requiredEnv.SUPABASE_URL,
      serviceRoleKey: requiredEnv.SUPABASE_SERVICE_ROLE_KEY,
    }),
    storage: createSupabaseStorageClient({
      url: requiredEnv.SUPABASE_URL,
      serviceRoleKey: requiredEnv.SUPABASE_SERVICE_ROLE_KEY,
    }),
    verifier: createGoogleTokenVerifier(requiredEnv.GOOGLE_OAUTH_CLIENT_ID),
    supabaseVerifier: createSupabaseAccessTokenVerifier(
      requiredEnv.SUPABASE_URL,
      requiredEnv.SUPABASE_ANON_KEY,
    ),
    sessionSecret: requiredEnv.SESSION_SECRET,
    vapid: readVapidKeys(runtimeEnv),
  });
  const url = new URL(request.url ?? "/api/v1", "https://equo.local");
  const result = await runtime.handle({
    method: (request.method ?? "GET") as HttpMethod,
    path: url.pathname,
    headers: {
      authorization: headerValue(request.headers.authorization),
      Authorization: headerValue(request.headers.Authorization),
      cookie: headerValue(request.headers.cookie),
      Cookie: headerValue(request.headers.Cookie),
      // Rate-limit buckets for anonymous callers are keyed by address. Vercel's
      // edge sets this itself and overwrites anything the client sent, so the
      // leading entry is the real peer.
      "x-forwarded-for": headerValue(request.headers["x-forwarded-for"]),
    },
    query: request.query,
    json: request.body,
  });

  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, String(value));
  }

  response.status(result.status).json(result.body);
}
