import { handleLineWebhookRequest } from "../../vercel-api/lineWebhookHandler.js";

/**
 * The Web-handler export format (as opposed to the `(req, res)` signature
 * api/v1/[...path].ts uses) is what gives this function `request.arrayBuffer()`
 * - the raw bytes LINE's signature check needs. See
 * vercel-api/lineWebhookHandler.ts for why this can't share v1Handler.ts's shape.
 *
 * This path (/api/line/webhook) sits outside both the /api/v1/(.*) rewrite
 * and the SPA fallback's (?!api/|assets/) negative lookahead in vercel.json,
 * so neither needs to change for this route to exist.
 */
export async function POST(request: Request): Promise<Response> {
  return handleLineWebhookRequest(request);
}
