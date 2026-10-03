/**
 * The thin HTTP client for LINE's Messaging API. Every call is fire-and-check:
 * the body is never read into an error, only the status code is - see
 * LineApiError - because the plan's PII rule ("never log message text,
 * replyToken, linkToken, nonce, email or raw LINE user ids") extends to
 * whatever LINE's own error bodies might echo back.
 */

import type { LineMessage } from "./lineFlex.js";

const LINE_API_BASE = "https://api.line.me";

/** A non-2xx response from LINE. The message carries the status only - never the response body. */
export class LineApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`LINE API request failed with status ${status}`);
    this.name = "LineApiError";
    this.status = status;
  }
}

// The message shapes live with the card kit; re-exported so every importer of
// the client keeps its import. Type-only: the runtime is unchanged.
export type { LineMessage } from "./lineFlex.js";

export type LineLeaveTarget = { type: "group"; groupId: string } | { type: "room"; roomId: string };

export type LineClient = {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  issueLinkToken(userId: string): Promise<string>;
  leave(target: LineLeaveTarget): Promise<void>;
};

export type LineClientOptions = {
  channelAccessToken: string;
  fetcher?: typeof fetch;
  /** Per-call timeout. LINE expects a 2xx within 2s of the webhook firing, so an outbound call cannot be allowed to hang far past that. */
  timeoutMs?: number;
};

export function createLineClient(options: LineClientOptions): LineClient {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;

  /** Content-Type describes a body, so it is sent only when there is one - issueLinkToken and leave have none. */
  function headers(hasBody: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${options.channelAccessToken}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    };
  }

  async function send(path: string, body: unknown): Promise<Response> {
    const response = await fetcher(`${LINE_API_BASE}${path}`, {
      method: "POST",
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new LineApiError(response.status);
    }

    return response;
  }

  return {
    async reply(replyToken, messages) {
      await send("/v2/bot/message/reply", { replyToken, messages });
    },

    async issueLinkToken(userId) {
      const response = await send(`/v2/bot/user/${encodeURIComponent(userId)}/linkToken`, undefined);
      const body = (await response.json()) as { linkToken?: string };
      if (!body.linkToken) {
        throw new LineApiError(response.status);
      }
      return body.linkToken;
    },

    async leave(target) {
      const path =
        target.type === "group"
          ? `/v2/bot/group/${encodeURIComponent(target.groupId)}/leave`
          : `/v2/bot/room/${encodeURIComponent(target.roomId)}/leave`;
      await send(path, undefined);
    },
  };
}
