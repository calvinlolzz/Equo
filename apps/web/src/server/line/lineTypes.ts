/**
 * Narrow types for the slice of LINE's webhook event payload this bot reads.
 * Deliberately not a full SDK type - see
 * https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects
 * for the full shape; anything not listed here is simply never read.
 */

export type LineSource = {
  type: "user" | "group" | "room" | string;
  userId?: string;
  groupId?: string;
  roomId?: string;
};

export type LineMessage = {
  type: "text" | string;
  id: string;
  text?: string;
};

export type LineEvent = {
  type:
    | "message"
    | "follow"
    | "unfollow"
    | "join"
    | "leave"
    | "accountLink"
    | "postback"
    | "unknown";
  mode?: "active" | "standby" | string;
  timestamp: number;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  replyToken?: string;
  source?: LineSource;
  message?: LineMessage;
  link?: { result: "ok" | "failed" | string; nonce?: string };
  follow?: { isUnblocked?: boolean };
};

const KNOWN_TYPES = new Set([
  "message",
  "follow",
  "unfollow",
  "join",
  "leave",
  "accountLink",
  "postback",
]);

/**
 * Parses the webhook body's `events` array. Returns null when the body isn't
 * shaped like a LINE delivery at all (not JSON, or `events` isn't an array) -
 * the caller answers 400 for that. Individual malformed entries are skipped
 * rather than failing the whole delivery: one bad event in a redelivered
 * batch should not sink the others.
 */
export function parseWebhookEvents(text: string): LineEvent[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }

  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return null;

  const parsed: LineEvent[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<LineEvent> & { type?: unknown; timestamp?: unknown };
    if (typeof candidate.timestamp !== "number") continue;

    const type = typeof candidate.type === "string" && KNOWN_TYPES.has(candidate.type)
      ? (candidate.type as LineEvent["type"])
      : "unknown";

    parsed.push({ ...(raw as object), type } as LineEvent);
  }

  return parsed;
}

const EVENT_ID_PATTERN = /^[0-9A-Za-z]{10,64}$/;

/**
 * The key every write this event causes is idempotent on - line_bot_entries'
 * webhook_event_id, and the client_request_id create_expense/soft_delete_expense
 * key on ("line:" + this value).
 *
 * Falls back to the message id (prefixed so it can never collide with a real
 * webhookEventId's character set) when webhookEventId is missing or
 * malformed - both are LINE-issued ids the SDK docs describe as safe to key
 * on. Returns null when NEITHER is usable, which the caller treats as "do not
 * write anything for this event" rather than guessing a key.
 */
export function lineEventKey(event: LineEvent): string | null {
  if (event.webhookEventId && EVENT_ID_PATTERN.test(event.webhookEventId)) {
    return event.webhookEventId;
  }

  if (event.message?.id) {
    return `msg:${event.message.id}`;
  }

  return null;
}
