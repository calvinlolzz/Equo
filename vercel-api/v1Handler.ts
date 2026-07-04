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
  const [
    { createHttpRuntime },
    { createGoogleTokenVerifier },
    { missingRuntimeEnv, readRuntimeEnv },
    { createSupabaseAccessTokenVerifier },
    { createSupabaseRestQueryClient },
    { createSupabaseStorageClient },
  ] = await Promise.all([
    import("../apps/web/src/server/http/runtime.js"),
    import("../apps/web/src/server/runtime/googleTokenVerifier.js"),
    import("../apps/web/src/server/runtime/runtimeEnv.js"),
    import("../apps/web/src/server/runtime/supabaseAuthVerifier.js"),
    import("../apps/web/src/server/runtime/supabaseQueryClient.js"),
    import("../apps/web/src/server/runtime/supabaseStorageClient.js"),
  ]);

  const runtimeEnv = readRuntimeEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    SESSION_SECRET: process.env.SESSION_SECRET,
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
    client: createSupabaseRestQueryClient({
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
    },
    query: request.query,
    json: request.body,
  });

  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, String(value));
  }

  response.status(result.status).json(result.body);
}
