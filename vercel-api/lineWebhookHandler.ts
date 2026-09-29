/**
 * The LINE webhook's own Vercel function entry, separate from
 * vercel-api/v1Handler.ts on purpose (see the plan's §1): Vercel's
 * `(req, res)` handler format parses the body before the handler runs, which
 * destroys the raw bytes LINE's signature check needs. The Web-handler format
 * this function is called from (`export function POST(request: Request)` in
 * api/line/webhook.ts) hands back `request.arrayBuffer()` untouched instead.
 *
 * Kept deliberately small: no import of server/http/runtime.ts, so this
 * function's cold start stays cheap and its dependency graph is easy to
 * reason about for the ESM check (scripts/check-api-esm-imports.py).
 */
export async function handleLineWebhookRequest(request: Request): Promise<Response> {
  try {
    const [{ createPostgrestClient }, { createLineClient }, { handleLineWebhook }, { readLineEnv, missingLineEnv }] =
      await Promise.all([
        import("../apps/web/src/server/db/postgrestClient.js"),
        import("../apps/web/src/server/line/lineClient.js"),
        import("../apps/web/src/server/line/lineWebhook.js"),
        import("../apps/web/src/server/runtime/runtimeEnv.js"),
      ]);

    const env = readLineEnv({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
      LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      APP_ORIGIN: process.env.APP_ORIGIN,
    });

    const missing = missingLineEnv(env);
    if (missing.length > 0) {
      // Variable NAMES only - never a value, even a missing one - so a
      // misconfigured deployment is diagnosable from the log without risking
      // an accidental echo of a value that IS set.
      console.error(`[line] webhook not configured, missing: ${missing.join(", ")}`);
      return Response.json(
        { error: "LINE_NOT_CONFIGURED" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    const client = createPostgrestClient({
      url: env.SUPABASE_URL as string,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    });
    const line = createLineClient({ channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN as string });

    const rawBody = new Uint8Array(await request.arrayBuffer());
    const signature = request.headers.get("x-line-signature");

    const result = await handleLineWebhook(
      { client, line, channelSecret: env.LINE_CHANNEL_SECRET as string, appOrigin: env.APP_ORIGIN },
      { rawBody, signature },
    );

    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const request_id = `req_line_err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    console.error(`[${request_id}] LINE webhook handler failed:`, error);
    return Response.json(
      { error: "INTERNAL_ERROR", request_id },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
