import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CATALOG } from "../../app/catalog.js";
import { EN as EN_APP } from "../../app/i18n/en.js";
import { createFakePostgrest, type FakePostgrest } from "../db/fakePostgrest.js";
import { resetSiteNoticeCache } from "../http/maintenance.js";
import { fill } from "../push/pushText.js";
import { LineApiError, type LineClient, type LineMessage } from "./lineClient.js";
import { sha256Hex } from "./lineCrypto.js";
import { actionsOf, lineReplyProblems, plainTextOf, postbacksOf, uriActionsOf } from "./lineFlexValidator.js";
import { LINE_MOOD_TEXT } from "./lineMoodText.js";
import { encodeLinePostback, parseLinePostback } from "./linePostback.js";
import { LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT } from "./lineText.js";
import { handleLineWebhook, type LineWebhookDeps } from "./lineWebhook.js";

// lineCards.ts is mocked only so a test can make the record card's builder
// throw on cue; every other card, and every other export, is the real thing.
const cardFaults = vi.hoisted(() => ({ recordCard: false, moodCard: false }));
vi.mock("./lineCards.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lineCards.js")>();
  return {
    ...actual,
    recordCard: (...args: Parameters<typeof actual.recordCard>) => {
      if (cardFaults.recordCard) throw new Error("recordCard exploded");
      return actual.recordCard(...args);
    },
    moodCard: (...args: Parameters<typeof actual.moodCard>) => {
      if (cardFaults.moodCard) throw new Error("moodCard exploded");
      return actual.moodCard(...args);
    },
  };
});

const SECRET = "test_channel_secret";
const APP_ORIGIN = "https://equo-mu.vercel.app";
const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("base64");
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function webhookBody(events: unknown[]): string {
  return JSON.stringify({ destination: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", events });
}

// Byte-identical to lineCrypto.test.ts's BODY_A/BODY_B - the same fixtures
// this bot's signature check was verified against.
const BODY_A = '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events":[]}';
const BODY_B =
  '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events":[{"type":"message","message":{"type":"text","id":"1","text":"早餐 60"},"webhookEventId":"01J0000000000000000000000A","deliveryContext":{"isRedelivery":false},"timestamp":1790000000000,"source":{"type":"user","userId":"U0123456789abcdef0123456789abcdef"},"replyToken":"rt1","mode":"active"}]}';

function messageEvent(
  opts: {
    text?: string;
    webhookEventId?: string;
    userId?: string;
    timestamp?: number;
    replyToken?: string;
    sourceType?: "user" | "group" | "room";
    mode?: string;
    isRedelivery?: boolean;
    nonText?: boolean;
  } = {},
) {
  return {
    type: "message",
    mode: opts.mode ?? "active",
    timestamp: opts.timestamp ?? 1790000000000,
    webhookEventId: opts.webhookEventId ?? "01J0000000000000000000000X",
    deliveryContext: { isRedelivery: opts.isRedelivery ?? false },
    replyToken: opts.replyToken ?? "rt1",
    source:
      opts.sourceType === "group"
        ? { type: "group", groupId: "G1" }
        : opts.sourceType === "room"
          ? { type: "room", roomId: "R1" }
          : { type: "user", userId: opts.userId ?? LINE_USER_ID },
    message: opts.nonText ? { type: "image", id: "2" } : { type: "text", id: "1", text: opts.text ?? "早餐 60" },
  };
}

function joinEvent(opts: { replyToken?: string; webhookEventId?: string } = {}) {
  return {
    type: "join",
    mode: "active",
    timestamp: 1790000000000,
    webhookEventId: opts.webhookEventId ?? "01J0000000000000000000000J",
    replyToken: opts.replyToken ?? "rt5",
    source: { type: "group", groupId: "G1" },
  };
}

function accountLinkEvent(
  opts: { result?: "ok" | "failed"; nonce?: string; userId?: string; replyToken?: string; webhookEventId?: string } = {},
) {
  const result = opts.result ?? "ok";
  const base: Record<string, unknown> = {
    type: "accountLink",
    mode: "active",
    timestamp: 1790000000000,
    webhookEventId: opts.webhookEventId ?? "01J0000000000000000000000C",
    source: { type: "user", userId: opts.userId ?? LINE_USER_ID },
    link: { result },
  };
  if (result === "ok") {
    base.replyToken = opts.replyToken ?? "rt3";
    (base.link as Record<string, unknown>).nonce = opts.nonce ?? "raw-nonce-value";
  }
  return base;
}

const LINKED_CONTEXT = {
  user_id: "user_1",
  email: "alice@example.com",
  locale: "zh-Hant",
  disabled: false,
  ledger: {
    id: "ledger_1",
    name: "我的帳本",
    currency: "TWD",
    owner_member_id: "member_1",
    cover_image_url: null,
    monthly_budget_minor: 0,
    kind: "personal",
  },
  categories: DEFAULT_CATALOG.categories,
};

/** What the delete RPCs say the entry is: expense_json, of which the bot reads only title / amount / currency. */
const ENTRY_SNAPSHOT = {
  id: "exp_1",
  title: "早餐",
  amount_minor: 6000,
  currency: "TWD",
  kind: "expense",
  category: "food",
  expense_date: "2026-09-21",
};

/** What line_streak says by default: the third day in a row, two entries today, a Monday-to-Wednesday week. */
const STREAK_STATS = {
  streak_days: 3,
  week: [true, true, true, false, false, false, false],
  today_index: 2,
  month_days: 12,
  today_entries: 1,
  total_entries: 40,
};

type RpcHandler = (args: Record<string, unknown>) => unknown;

function createLineFakeClient(overrides: Partial<Record<string, RpcHandler>> = {}) {
  const state = { recordedEntries: new Map<string, unknown>() };

  const defaults: Record<string, RpcHandler> = {
    site_notice_settings: () => ({
      banner: { message: "", level: "info", ends_at: null, active: false },
      maintenance: { enabled: false, message: "" },
    }),
    consume_rate_limit: () => ({ allowed: true }),
    line_register_link_token: () => ({ ok: true }),
    line_unlink: () => ({ ok: true, unlinked: true }),
    line_month_summary: () => ({
      ok: true,
      ledger_id: "ledger_1",
      currency: "TWD",
      budget_minor: 0,
      month: { expense_minor: 0, income_minor: 0 },
    }),
    line_set_budget: (args) => ({
      ok: true,
      ledger_id: "ledger_1",
      currency: "TWD",
      budget_minor: args.p_budget_minor,
      month: { expense_minor: 600000, income_minor: 0 },
    }),
    line_context: () => null,
    line_consume_link_nonce: () => ({ ok: false, reason: "unknown" }),
    line_record_entry: (args) => {
      const eventId = args.p_event_id as string;
      const replay = state.recordedEntries.has(eventId);
      const expense =
        state.recordedEntries.get(eventId) ??
        {
          id: `exp_${eventId}`,
          title: args.p_title,
          kind: args.p_kind,
          category: args.p_category,
          amount_minor: args.p_amount_minor,
          currency: "TWD",
          expense_date: args.p_expense_date,
        };
      state.recordedEntries.set(eventId, expense);
      const amountMinor = (expense as { amount_minor: number }).amount_minor;
      return {
        ok: true,
        replay,
        expense,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: 0,
        month: { expense_minor: amountMinor, income_minor: 0 },
      };
    },
    line_undo_last: () => ({
      ok: true,
      replay: false,
      expense: { id: "exp_undo", title: "早餐", amount_minor: 6000, currency: "TWD" },
    }),
    line_streak: () => ({ ok: true, stats: STREAK_STATS }),
    line_entry_status: () => ({ ok: true, status: "live", edited: false, expense: ENTRY_SNAPSHOT }),
    line_delete_entry: () => ({ ok: true, replay: false, expense: ENTRY_SNAPSHOT }),
  };

  const merged = { ...defaults, ...overrides };

  const client: FakePostgrest = createFakePostgrest({
    rpc: (fn, args) => {
      const handler = merged[fn];
      if (!handler) throw new Error(`unexpected rpc ${fn}`);
      return handler(args);
    },
  });

  return { client, state };
}

/**
 * Everything LINE would have refused, found by the validator on every reply
 * any fake client in this file received. LINE answers a bad message with a
 * 400 the bot never reads the reason of, so "the test passed" must also mean
 * "LINE would have accepted it" - afterEach below turns a non-empty list into
 * a failure.
 */
let replyProblems: string[] = [];

/**
 * `failStatuses` makes reply attempts fail with that HTTP status, in order (a
 * LineApiError, as the real client throws; an Error is thrown as it is, the
 * way a timeout reaches safeReply; null lets that attempt through).
 * Every attempt is
 * recorded in `calls.reply` first, failed or not, so a test sees what was
 * sent and in what order - including the retry.
 */
function fakeLineClient(options: { failStatuses?: Array<number | Error | null>; issueLinkTokenFails?: boolean } = {}) {
  const calls: {
    reply: Array<{ replyToken: string; messages: LineMessage[] }>;
    issueLinkToken: string[];
    leave: Array<{ type: "group" | "room"; groupId?: string; roomId?: string }>;
  } = { reply: [], issueLinkToken: [], leave: [] };
  let issuedToken = "faketoken123";
  const failStatuses = [...(options.failStatuses ?? [])];

  const client: LineClient = {
    async reply(replyToken, messages) {
      calls.reply.push({ replyToken, messages });
      for (const problem of lineReplyProblems(messages)) replyProblems.push(`${problem} (reply ${calls.reply.length})`);
      // null = let this attempt through; an empty queue lets it through too.
      const status = failStatuses.shift();
      if (typeof status === "number") throw new LineApiError(status);
      if (status instanceof Error) throw status;
    },
    async issueLinkToken(userId) {
      calls.issueLinkToken.push(userId);
      if (options.issueLinkTokenFails) throw new Error("LINE is down");
      return issuedToken;
    },
    async leave(target) {
      calls.leave.push(target as { type: "group" | "room"; groupId?: string; roomId?: string });
    },
  };

  return { client, calls, setIssuedToken: (token: string) => (issuedToken = token) };
}

function deps(client: FakePostgrest, line: LineClient): LineWebhookDeps {
  return { client, line, channelSecret: SECRET, appOrigin: APP_ORIGIN };
}

beforeEach(() => {
  resetSiteNoticeCache();
  replyProblems = [];
  cardFaults.recordCard = false;
  cardFaults.moodCard = false;
});

afterEach(() => {
  expect(replyProblems, "a reply LINE would have refused").toEqual([]);
});

describe("handleLineWebhook - signature and framing", () => {
  test("a bad signature returns 401 without touching the database or LINE", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();

    const result = await handleLineWebhook(deps(client, line.client), {
      rawBody: bytes(BODY_B),
      signature: "not-the-real-signature",
    });

    expect(result.status).toBe(401);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });

  test("LINE's verification payload (empty events) returns 200", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_A), signature: sign(BODY_A) });

    expect(result.status).toBe(200);
  });

  test("a body over 256 KB is rejected with 413 before verifying", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const huge = webhookBody([]) + " ".repeat(300 * 1024);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(huge), signature: sign(huge) });

    expect(result.status).toBe(413);
    expect(client.calls).toHaveLength(0);
  });

  test("standby mode events are ignored entirely", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([messageEvent({ mode: "standby" })]);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });
});

describe("handleLineWebhook - recording", () => {
  test("a linked user's expense calls line_record_entry with exact args and replies with quick replies", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

    expect(result.status).toBe(200);
    const call = client.rpcCall("line_record_entry");
    expect(call?.args).toEqual({
      p_line_user_id: "U0123456789abcdef0123456789abcdef",
      p_event_id: "01J0000000000000000000000A",
      p_title: "早餐",
      p_kind: "expense",
      p_category: "food",
      p_amount_minor: 6000,
      p_expense_date: "2026-09-21",
      p_month_start: "2026-09-01",
    });

    expect(line.calls.reply).toHaveLength(1);
    expect(line.calls.reply[0].replyToken).toBe("rt1");
    const messages = line.calls.reply[0].messages as Array<{ quickReply?: { items: unknown[] } }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].quickReply).toBeUndefined();
    expect(messages[1].quickReply?.items.length).toBeGreaterThan(0);
  });

  // [MV]: redelivery must reuse the SAME event id both times. If the
  // implementation ever derives the idempotency key from something that
  // changes per delivery (e.g. Date.now()) instead of the webhook's own
  // event id, this goes red.
  test("redelivery is idempotent: both deliveries carry the same event id and only one entry is stored", async () => {
    const { client, state } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();
    const d = deps(client, line.client);

    await handleLineWebhook(d, { rawBody: bytes(BODY_B), signature: sign(BODY_B) });
    const redelivered = BODY_B.replace('"isRedelivery":false', '"isRedelivery":true');
    await handleLineWebhook(d, { rawBody: bytes(redelivered), signature: sign(redelivered) });

    const eventIds = client.calls
      .filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc" && c.fn === "line_record_entry")
      .map((c) => c.args.p_event_id);

    expect(eventIds).toEqual(["01J0000000000000000000000A", "01J0000000000000000000000A"]);
    expect(state.recordedEntries.size).toBe(1);
  });

  test("undo delivered twice (replay) sends the same event id both times", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();
    const d = deps(client, line.client);
    const body = webhookBody([messageEvent({ text: "復原", webhookEventId: "01J0000000000000000000000U", replyToken: "rt2" })]);

    await handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
    await handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });

    const eventIds = client.calls
      .filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc" && c.fn === "line_undo_last")
      .map((c) => c.args.p_event_id);

    expect(eventIds).toEqual(["01J0000000000000000000000U", "01J0000000000000000000000U"]);
  });
});

describe("handleLineWebhook - group chats", () => {
  test("a group text message is ignored silently", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([messageEvent({ sourceType: "group" })]);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });

  test("join replies groupNotSupported, then leaves the group", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([joinEvent()]);

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(line.calls.reply).toHaveLength(1);
    expect((line.calls.reply[0].messages[0] as { text: string }).text).toBe(ZH_HANT.groupNotSupported);
    expect(line.calls.leave).toEqual([{ type: "group", groupId: "G1" }]);
  });
});

describe("handleLineWebhook - linking", () => {
  // [MV]: the raw link token must never reach a database call - only its
  // sha256 hash. If a future edit passes the raw token to
  // line_register_link_token, this goes red.
  test("an unlinked user's message issues a link token and shows the link button; the raw token never touches the DB", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    line.setIssuedToken("linktoken123");

    const body = webhookBody([messageEvent({ text: "早餐 60" })]);
    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(line.calls.issueLinkToken).toEqual([LINE_USER_ID]);

    const registerCall = client.rpcCall("line_register_link_token");
    expect(registerCall?.args.p_link_token_hash).toBe(sha256Hex("linktoken123"));

    for (const call of client.calls) {
      expect(JSON.stringify(call)).not.toContain("linktoken123");
    }

    const lastReply = line.calls.reply.at(-1)!;
    const card = lastReply.messages.find((m) => m.type === "flex");
    expect(card).toBeDefined();
    const uris = uriActionsOf(card!).map((action) => action.uri);
    expect(uris).toHaveLength(1);
    expect(uris[0]).toContain("openExternalBrowser=1");
    expect(uris[0]).toContain("linkToken=linktoken123");
  });

  // [MV]: same guard as above, for the nonce this time.
  test("accountLink ok consumes the nonce's hash, never the raw nonce, and replies", async () => {
    const { client } = createLineFakeClient({
      line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "zh-Hant" }),
    });
    const line = fakeLineClient();
    const body = webhookBody([accountLinkEvent({ nonce: "raw-nonce-value" })]);

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    const call = client.rpcCall("line_consume_link_nonce");
    expect(call?.args.p_nonce_hash).toBe(sha256Hex("raw-nonce-value"));

    for (const c of client.calls) {
      expect(JSON.stringify(c)).not.toContain("raw-nonce-value");
    }
    expect(line.calls.reply).toHaveLength(1);
  });

  test("accountLink failed carries no replyToken and makes no calls at all", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([accountLinkEvent({ result: "failed" })]);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });
});

describe("handleLineWebhook - maintenance", () => {
  test("maintenance blocks recording but still consumes an accountLink nonce", async () => {
    const { client } = createLineFakeClient({
      site_notice_settings: () => ({
        banner: { message: "", level: "info", ends_at: null, active: false },
        maintenance: { enabled: true, message: "維護中" },
      }),
      line_context: () => LINKED_CONTEXT,
      line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "zh-Hant" }),
    });
    const line = fakeLineClient();
    const d = deps(client, line.client);

    const recordResult = await handleLineWebhook(d, { rawBody: bytes(BODY_B), signature: sign(BODY_B) });
    expect(recordResult.status).toBe(200);
    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect((line.calls.reply.at(-1)!.messages[0] as { text: string }).text).toBe(ZH_HANT.maintenance);

    const accountLinkBody = webhookBody([accountLinkEvent()]);
    await handleLineWebhook(d, { rawBody: bytes(accountLinkBody), signature: sign(accountLinkBody) });
    expect(client.rpcCall("line_consume_link_nonce")).toBeDefined();
  });
});

describe("handleLineWebhook - rate limiting", () => {
  test("rate limited: no record is made", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      consume_rate_limit: () => ({ allowed: false, retry_after: 5 }),
    });
    const line = fakeLineClient();

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect((line.calls.reply.at(-1)!.messages[0] as { text: string }).text).toBe(ZH_HANT.rateLimited);
  });

  test("a throwing rate limiter still records (fail-open)", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      consume_rate_limit: () => {
        throw new Error("counter down");
      },
    });
    const line = fakeLineClient();

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

    expect(client.rpcCall("line_record_entry")).toBeDefined();
  });
});

describe("handleLineWebhook - error handling", () => {
  // [MV]: the log line must never carry the message text, the reply token or
  // a raw LINE user id. Change the log call to interpolate
  // event.message?.text (or event.replyToken, or the raw userId) and this
  // goes red.
  test("a throwing RPC still returns 200 with a generic-error reply, and logs neither the message text, the reply token, nor a raw LINE userId", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: () => {
          throw new Error("boom");
        },
      });
      const line = fakeLineClient();

      const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

      expect(result.status).toBe(200);
      expect((line.calls.reply.at(-1)!.messages[0] as { text: string }).text).toBe(ZH_HANT.genericError);

      const logged = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("早餐");
      expect(logged).not.toContain("rt1");
      expect(logged).not.toContain(LINE_USER_ID);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("handleLineWebhook - review fixes", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const textOf = (line: ReturnType<typeof fakeLineClient>) => plainTextOf(line.calls.reply.at(-1)!.messages[0]);

  // [MV]: the rate limit is the first database call, ahead of the context lookup.
  test("a rate-limited message never reaches line_context, and is answered in zh-Hant", async () => {
    const { client } = createLineFakeClient({
      consume_rate_limit: () => ({ allowed: false, retry_after: 5 }),
      line_context: () => {
        throw new Error("line_context must not be called");
      },
    });
    const line = fakeLineClient();

    const result = await send(deps(client, line.client), [messageEvent({ text: "早餐 60" })]);

    expect(result.status).toBe(200);
    expect(client.rpcCall("line_context")).toBeUndefined();
    expect(textOf(line)).toBe(ZH_HANT.rateLimited);
    expect(client.calls.map((c) => (c.op === "rpc" ? c.fn : c.op))).toEqual(["consume_rate_limit"]);
  });

  test("a linked user sending 綁定 is told they are already linked (masked email) and no link is issued", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "綁定" })]);

    expect(line.calls.issueLinkToken).toHaveLength(0);
    expect(client.rpcCall("line_register_link_token")).toBeUndefined();
    expect(textOf(line)).toContain("al***@example.com");
    expect(textOf(line)).not.toContain("alice@example.com");
  });

  // [MV]
  test("解除綁定 still works while maintenance is on", async () => {
    const { client } = createLineFakeClient({
      site_notice_settings: () => ({
        banner: { message: "", level: "info", ends_at: null, active: false },
        maintenance: { enabled: true, message: "" },
      }),
      line_context: () => LINKED_CONTEXT,
    });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "解除綁定" })]);

    expect(client.rpcCall("line_unlink")).toBeDefined();
    expect(textOf(line)).toBe(ZH_HANT.unlinked);
  });

  test("a redelivered undo that found nothing keeps answering the same, even after a new entry exists", async () => {
    // Mirrors line_undo_last's contract: the first outcome for an event id is
    // remembered and echoed, so a later, newer entry is never touched.
    const outcomes = new Map<string, unknown>();
    const entries: string[] = [];
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_undo_last: (args) => {
        const key = args.p_event_id as string;
        if (outcomes.has(key)) return { ...(outcomes.get(key) as object), replay: true };
        const outcome = entries.length
          ? { ok: true, replay: false, expense: { title: entries.pop(), amount_minor: 6000, currency: "TWD" } }
          : { ok: false, reason: "nothing_to_undo" };
        outcomes.set(key, outcome);
        return outcome;
      },
    });
    const line = fakeLineClient();
    const undo = messageEvent({ text: "復原", webhookEventId: "01J0000000000000000000000U" });

    await send(deps(client, line.client), [undo]);
    const first = textOf(line);
    entries.push("新的一筆");
    await send(deps(client, line.client), [{ ...undo, deliveryContext: { isRedelivery: true } }]);

    expect(first).toContain("沒有可以復原");
    expect(textOf(line)).toBe(first);
    expect(entries).toEqual(["新的一筆"]);
  });

  test("a date in the message is refused with the pointer to the app", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "午餐 120 9/30" })]);

    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect(textOf(line)).toBe(ZH_HANT.dateNotSupported);
  });

  test("「薪水 50000」 is recorded as income / salary", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "薪水 50000" })]);

    expect(client.rpcCall("line_record_entry")?.args).toMatchObject({
      p_kind: "income",
      p_category: "salary",
      p_amount_minor: 5000000,
      p_title: "薪水",
    });
  });
});

describe("handleLineWebhook - budget commands", () => {
  // 2026-09 in Taiwan time, so the month passed to the RPCs is 2026-09-01.
  const budgetDeps = (client: FakePostgrest, line: LineClient): LineWebhookDeps => ({
    ...deps(client, line),
    now: () => 1790000000000,
  });
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  // `text` is what a person reading the notification sees - a text message's
  // text, or a card's altText - so these tests hold for either shape.
  const messageOf = (line: ReturnType<typeof fakeLineClient>) => {
    const message = line.calls.reply.at(-1)!.messages[0];
    return {
      text: plainTextOf(message),
      quickReply: message.quickReply as
        | { items: Array<{ action: { type: string; label: string; uri?: string } }> }
        | undefined,
    };
  };
  const rpcCalls = (client: FakePostgrest, fn: string) =>
    client.calls.filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc" && c.fn === fn);
  const maintenanceOn = () => ({
    banner: { message: "", level: "info", ends_at: null, active: false },
    maintenance: { enabled: true, message: "" },
  });

  test("「預算 15000」 sets the budget and replies with budget, spent, what is left and the quick replies", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(client.rpcCall("line_set_budget")?.args).toEqual({
      p_line_user_id: LINE_USER_ID,
      p_budget_minor: 1500000,
      p_month_start: "2026-09-01",
    });
    const message = messageOf(line);
    expect(message.text).toContain("$15,000");
    expect(message.text).toContain("$6,000");
    expect(message.text).toContain("還剩 $9,000");
    expect(message.quickReply?.items.map((i) => i.action.label)).toEqual(["本月", "明細", "分析", "說明"]);
    expect(message.quickReply?.items[1].action.uri).toBe("https://equo-mu.vercel.app/group/ledger_1?view=records&openExternalBrowser=1");
    expect(message.quickReply?.items[2].action.uri).toBe("https://equo-mu.vercel.app/group/ledger_1?view=analysis&openExternalBrowser=1");
  });

  test("over budget says how far over", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_set_budget: (args) => ({
        ok: true,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: args.p_budget_minor,
        month: { expense_minor: 2000000, income_minor: 0 },
      }),
    });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(messageOf(line).text).toContain("已超出 $5,000");
  });

  // [MV]: pass undefined (or leave the key out) instead of null and this goes
  // red - JSON drops an undefined key and PostgREST then cannot find the function.
  test("「取消預算」 sends an explicit null and replies budgetCleared", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "取消預算" })]);

    expect(client.rpcCall("line_set_budget")?.args).toEqual({
      p_line_user_id: LINE_USER_ID,
      p_budget_minor: null,
      p_month_start: "2026-09-01",
    });
    expect(messageOf(line).text).toBe(ZH_HANT.budgetCleared);
  });

  // [MV]: remove the gate from the write handler, or add one to the show handler, and this goes red.
  test("maintenance blocks setting and clearing, but not viewing", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      site_notice_settings: maintenanceOn,
    });
    const line = fakeLineClient();
    const d = budgetDeps(client, line.client);

    await send(d, [messageEvent({ text: "預算 15000" })]);
    expect(messageOf(line).text).toBe(ZH_HANT.maintenance);
    await send(d, [messageEvent({ text: "取消預算" })]);
    expect(messageOf(line).text).toBe(ZH_HANT.maintenance);
    expect(client.rpcCall("line_set_budget")).toBeUndefined();

    await send(d, [messageEvent({ text: "預算" })]);
    expect(client.rpcCall("line_month_summary")).toBeDefined();
    expect(messageOf(line).text).not.toBe(ZH_HANT.maintenance);
  });

  test("「預算」 with no budget set explains how to set one; with a budget it shows it", async () => {
    let budget: number | null = null;
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_month_summary: () => ({
        ok: true,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: budget,
        month: { expense_minor: 600000, income_minor: 0 },
      }),
    });
    const line = fakeLineClient();
    const d = budgetDeps(client, line.client);

    await send(d, [messageEvent({ text: "預算" })]);
    expect(messageOf(line).text).toBe(ZH_HANT.budgetNone);

    budget = 1500000;
    await send(d, [messageEvent({ text: "預算" })]);
    expect(messageOf(line).text).toContain("每月預算 $15,000");
    expect(rpcCalls(client, "line_month_summary")[1].args.p_month_start).toBe("2026-09-01");
  });

  test("「預算 0」 is refused with budgetInvalid and touches neither RPC", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 0" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(client.rpcCall("line_month_summary")).toBeUndefined();
    expect(messageOf(line).text).toBe(ZH_HANT.budgetInvalid);
  });

  test("「預算外 300」 is still recorded as an expense", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算外 300" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(client.rpcCall("line_record_entry")?.args).toMatchObject({ p_title: "預算外", p_amount_minor: 30000 });
  });

  test("the same delivery twice makes two identical calls and gets an identical reply", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();
    const d = budgetDeps(client, line.client);
    const event = messageEvent({ text: "預算 15000", webhookEventId: "01J0000000000000000000000B" });

    await send(d, [event]);
    await send(d, [{ ...event, deliveryContext: { isRedelivery: true } }]);

    const calls = rpcCalls(client, "line_set_budget");
    expect(calls).toHaveLength(2);
    expect(calls[1].args).toEqual(calls[0].args);
    expect(line.calls.reply).toHaveLength(2);
    expect(line.calls.reply[1].messages).toEqual(line.calls.reply[0].messages);
  });

  test("a missing ledger answers noLedger", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_set_budget: () => ({ ok: false, reason: "no_ledger" }),
    });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(messageOf(line).text).toBe(ZH_HANT.noLedger);
  });

  test("a too-large budget gets budgetTooLarge, not the 'above 0' text, and touches no RPC", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 99999999999" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(messageOf(line).text).toBe(ZH_HANT.budgetTooLarge);
  });

  test("a near-miss like 「預算 15000 餐飲」 asks what was meant and records nothing", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000 餐飲" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect(messageOf(line).text).toBe(ZH_HANT.budgetAmbiguous);
  });

  test("an English-locale user gets the English reply", async () => {
    const { client } = createLineFakeClient({ line_context: () => ({ ...LINKED_CONTEXT, locale: "en" }) });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(messageOf(line).text.startsWith("Monthly budget set to")).toBe(true);
    expect(messageOf(line).text).toContain("$9,000 left");
  });
});

describe("handleLineWebhook - help card", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };

  test("a linked user's 說明 gets one help card whose altText is the plain help text, with the quick reply minus 說明", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

    expect(line.calls.reply).toHaveLength(1);
    const { messages } = line.calls.reply[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("flex");
    expect(plainTextOf(messages[0])).toBe(fill(ZH_HANT.help, { minutes: 30 }));
    expect(messages[0].quickReply?.items.map((item) => item.action.label)).toEqual(["本月", "明細", "分析"]);
    // Nothing on the card can be tapped: an example command that sent itself would record real data.
    expect(JSON.stringify((messages[0] as { contents: unknown }).contents)).not.toContain('"action"');
  });

  test("an English-locale user gets the English help card", async () => {
    const { client } = createLineFakeClient({ line_context: () => ({ ...LINKED_CONTEXT, locale: "en" }) });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "help" })]);

    const [message] = line.calls.reply[0].messages;
    expect(message.type).toBe("flex");
    expect(plainTextOf(message)).toBe(fill(EN.help, { minutes: 30 }));
    expect(JSON.stringify(message)).toContain(EN.helpCardTitle);
  });

  test("an unlinked user asking for help gets the help card, then the link button, in one reply", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

    expect(line.calls.reply).toHaveLength(1);
    const { messages } = line.calls.reply[0];
    expect(messages.map((message) => message.type)).toEqual(["flex", "flex"]);
    expect(plainTextOf(messages[0])).toBe(fill(ZH_HANT.help, { minutes: 30 }));
    expect(plainTextOf(messages[1])).toBe(ZH_HANT.linkAltText);
    expect(uriActionsOf(messages[1])[0].uri).toContain("openExternalBrowser=1");
    // The link card follows, so no quick reply on either: it would be removed at once.
    expect(messages.map((message) => message.quickReply)).toEqual([undefined, undefined]);
  });
});

describe("handleLineWebhook - a card LINE refuses falls back to text", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const HELP_TEXT = fill(ZH_HANT.help, { minutes: 30 });

  // Silenced and inspected: these tests make the bot log on purpose.
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
  const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((call) => call.join(" "));

  // [MV]: remove the retry and there is no second call.
  test("a 400 resends the same reply once, as the plain text the card replaced, on the same token", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient({ failStatuses: [400] });

    const result = await send(deps(client, line.client), [messageEvent({ text: "說明", replyToken: "rt-help" })]);

    expect(result.status).toBe(200);
    expect(line.calls.reply).toHaveLength(2);
    expect(line.calls.reply[0].messages.map((message) => message.type)).toEqual(["flex"]);
    expect(line.calls.reply[1].replyToken).toBe("rt-help");
    expect(line.calls.reply[1].messages).toEqual([{ type: "text", text: HELP_TEXT, quickReply: line.calls.reply[0].messages[0].quickReply }]);
    expect(line.calls.reply[1].messages[0].quickReply?.items).toHaveLength(3);

    expect(logged(errorSpy)).toEqual(["[line] flex reply rejected (status 400; cards: help), resending as text"]);
    expect(logged(warnSpy)).toEqual(["[line] text fallback delivered (cards: help)"]);
  });

  // [MV]: put the message text, the reply token or the user id into either log line and this goes red.
  test("the log lines carry no message text, reply token, user id or reply content", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient({ failStatuses: [400] });

    await send(deps(client, line.client), [messageEvent({ text: "說明", replyToken: "rt-secret-token" })]);

    const all = [...logged(errorSpy), ...logged(warnSpy)].join("\n");
    expect(all).not.toContain("rt-secret-token");
    expect(all).not.toContain(LINE_USER_ID);
    expect(all).not.toContain("說明");
    expect(all).not.toContain("Equo 記帳小幫手");
    expect(all).not.toContain("alice");
  });

  // [MV]: retry on any status and the 500 gets a second call.
  test("a 500 is not a card problem: one call, no retry, the usual reply-failed log", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient({ failStatuses: [500] });

    const result = await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

    expect(result.status).toBe(200);
    expect(line.calls.reply).toHaveLength(1);
    expect(logged(errorSpy)).toEqual(["[line] reply failed: LINE API request failed with status 500"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // [MV]: retry without checking that a card was sent and a refused text reply gets a pointless second call.
  test("a 400 on a plain text reply is not retried", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient({ failStatuses: [400] });

    const result = await send(deps(client, line.client), [messageEvent({ text: "解除綁定" })]);

    expect(result.status).toBe(200);
    expect(line.calls.reply).toHaveLength(1);
    expect(logged(errorSpy)).toEqual(["[line] reply failed: LINE API request failed with status 400"]);
  });

  test("when the text fallback is refused too, nothing escapes: 200, both attempts made, the failure logged", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient({ failStatuses: [400, 400] });

    const result = await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

    expect(result.status).toBe(200);
    expect(line.calls.reply).toHaveLength(2);
    expect(logged(errorSpy)).toEqual([
      "[line] flex reply rejected (status 400; cards: help), resending as text",
      "[line] text fallback failed: LINE API request failed with status 400",
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("a reply of two cards resends both as the plain messages they replaced: the help text, then the link buttons", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient({ failStatuses: [400] });

    await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

    expect(line.calls.reply).toHaveLength(2);
    const [first, second] = line.calls.reply;
    expect(first.messages.map((message) => message.type)).toEqual(["flex", "flex"]);
    expect(second.messages.map((message) => message.type)).toEqual(["text", "template"]);
    expect(plainTextOf(second.messages[0])).toBe(HELP_TEXT);
    // The link button survives the fallback, to the same place.
    expect(uriActionsOf(second.messages[1])).toEqual(uriActionsOf(first.messages[1]));
    expect(uriActionsOf(second.messages[1])).toHaveLength(1);
  });

  test("a plain message sharing the reply with a card goes out untouched on the resend", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient({ failStatuses: [400], issueLinkTokenFails: true });

    await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

    expect(line.calls.reply).toHaveLength(2);
    const [first, second] = line.calls.reply;
    expect(first.messages.map((message) => message.type)).toEqual(["flex", "text"]);
    expect(second.messages).toEqual([{ type: "text", text: HELP_TEXT }, { type: "text", text: ZH_HANT.linkUnavailable }]);
    expect(second.messages[1]).toEqual(first.messages[1]);
  });
});

describe("handleLineWebhook - record, month and budget cards", () => {
  // 2026-09 in Taiwan time, so the month passed to the RPCs is 2026-09-01.
  const cardDeps = (client: FakePostgrest, line: LineClient): LineWebhookDeps => ({
    ...deps(client, line),
    now: () => 1790000000000,
  });
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const lastMessage = (line: ReturnType<typeof fakeLineClient>) => line.calls.reply.at(-1)!.messages[0];
  /** A record is answered with two messages; this is the last reply's whole list. */
  const lastMessages = (line: ReturnType<typeof fakeLineClient>) => line.calls.reply.at(-1)!.messages;
  const labelsOf = (message: LineMessage) => (message.quickReply?.items ?? []).map((item) => item.action.label);
  const cardTexts = (message: LineMessage): string[] => {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;
        if (record.type === "text") found.push(record.text as string);
        Object.values(record).forEach(walk);
      }
    };
    if (message.type === "flex") walk(message.contents);
    return found;
  };

  /** A record result with a budget, so the month figures are not just this entry's amount. */
  const recordWithBudget = (month: { expense_minor: number; income_minor: number }) => (args: Record<string, unknown>) => ({
    ok: true,
    replay: false,
    expense: {
      id: "exp_1",
      title: args.p_title,
      kind: args.p_kind,
      category: args.p_category,
      amount_minor: args.p_amount_minor,
      currency: "TWD",
      expense_date: args.p_expense_date,
    },
    ledger_id: "ledger_1",
    currency: "TWD",
    budget_minor: 1_500_000,
    month,
  });

  describe("record", () => {
    // [MV]: change a card's altText, or drop the record quick reply, and this goes red.
    test("an expense is a card whose altText is today's text, with exactly 復原 / 本月 / 明細 / 分析 under it", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: recordWithBudget({ expense_minor: 606_000, income_minor: 0 }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      expect(line.calls.reply).toHaveLength(1);
      expect(line.calls.reply[0].messages).toHaveLength(2);
      const [message, mood] = lastMessages(line);
      expect(message.type).toBe("flex");
      expect(mood.type).toBe("flex");
      expect(plainTextOf(message)).toBe("已記下支出：早餐 $60（餐飲）\n本月支出 $6,060，預算剩 $8,940");
      // The shortcuts belong to the LAST message: LINE drops them when another message follows.
      expect(labelsOf(message)).toEqual([]);
      expect(labelsOf(mood)).toEqual(["復原", "本月", "明細", "分析"]);
      // The date on the card is the date the entry was recorded under.
      expect(cardTexts(message)).toContain("9月21日");
      expect(client.rpcCall("line_record_entry")?.args.p_expense_date).toBe("2026-09-21");
    });

    test("an income is a card too, in the dictionary's words for income", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: recordWithBudget({ expense_minor: 0, income_minor: 5_200_000 }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "+52000 薪水" })]);

      const [message, mood] = lastMessages(line);
      expect(message.type).toBe("flex");
      expect(plainTextOf(message)).toBe("已記下收入：薪水 $52,000（薪資）\n本月收入 $52,000");
      expect(cardTexts(message)).toContain("+$52,000");
      expect(labelsOf(mood)).toEqual(["復原", "本月", "明細", "分析"]);
    });

    test("an English-locale user's category reads in English on the card and in the altText", async () => {
      const { client } = createLineFakeClient({
        line_context: () => ({ ...LINKED_CONTEXT, locale: "en" }),
        line_record_entry: recordWithBudget({ expense_minor: 606_000, income_minor: 0 }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "breakfast 60" })]);

      const message = lastMessage(line);
      expect(plainTextOf(message)).toBe("Recorded expense: breakfast $60 (Food)\nSpent this month: $6,060, $8,940 left in budget");
      expect(cardTexts(message)).toContain("Food");
      expect(cardTexts(message)).not.toContain("餐飲");
    });

    test("an admin-renamed catalog label wins in zh, and a category colour LINE would reject is tamed", async () => {
      const categories = DEFAULT_CATALOG.categories.map((category) =>
        category.key === "food" ? { ...category, label: "吃吃喝喝", color: "red" } : category,
      );
      const { client } = createLineFakeClient({ line_context: () => ({ ...LINKED_CONTEXT, categories }) });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      // The afterEach validator would fail the test if "red" reached the card.
      const message = lastMessage(line);
      expect(plainTextOf(message)).toContain("（吃吃喝喝）");
      expect(cardTexts(message)).toContain("吃吃喝喝");
    });

    // [MV]: remove the cardOrFallback try/catch and the saved entry is answered with genericError.
    test("a card that cannot be built still answers the saved entry with its plain text and quick replies", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      cardFaults.recordCard = true;
      try {
        const { client } = createLineFakeClient({
          line_context: () => LINKED_CONTEXT,
          line_record_entry: recordWithBudget({ expense_minor: 606_000, income_minor: 0 }),
        });
        const line = fakeLineClient();

        const result = await send(cardDeps(client, line.client), [messageEvent({ text: "早餐 60" })]);

        expect(result.status).toBe(200);
        expect(client.rpcCall("line_record_entry")).toBeDefined();
        expect(line.calls.reply).toHaveLength(1);
        const [message, mood] = lastMessages(line);
        expect(message).toMatchObject({ type: "text", text: "已記下支出：早餐 $60（餐飲）\n本月支出 $6,060，預算剩 $8,940" });
        expect(labelsOf(message)).toEqual([]);
        // The mood card is not the record card's problem: it is still a card, and it still carries the shortcuts.
        expect(mood.type).toBe("flex");
        expect(labelsOf(mood)).toEqual(["復原", "本月", "明細", "分析"]);
        expect(plainTextOf(message)).not.toBe(ZH_HANT.genericError);
        expect(errorSpy.mock.calls.map((call) => call.join(" "))).toEqual(["[line] card build failed (record): recordCard exploded"]);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("本月", () => {
    const FIXTURE_CATEGORIES = [
      { category: "shopping", expense_minor: 50000 },
      { category: "food", expense_minor: 30000 },
      { category: "transport", expense_minor: 30000 },
      { category: "health", expense_minor: 5000 },
      { category: "general", expense_minor: 4500 },
    ];
    const summary = (extra: Record<string, unknown>, month = { expense_minor: 126_500, income_minor: 0 }) => () => ({
      ok: true,
      ledger_id: "ledger_1",
      currency: "TWD",
      budget_minor: 1_500_000,
      month,
      ...extra,
    });
    const label = (key: string, locale = "zh-Hant") =>
      locale === "en"
        ? (EN_APP.categories as Record<string, string>)[key]
        : DEFAULT_CATALOG.categories.find((category) => category.key === key)!.label;

    test("a card with the month's figures, its categories largest first, and the rest folded into 其餘分類", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_month_summary: summary({ categories: FIXTURE_CATEGORIES }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "本月" })]);

      const message = lastMessage(line);
      expect(message.type).toBe("flex");
      expect(plainTextOf(message)).toBe("本月（2026 年 9 月）\n支出 $1,265\n收入 $0\n結餘 $-1,265\n預算剩餘 $13,735");
      const texts = cardTexts(message);
      const rows = ["shopping", "food", "transport", "health", "general"].map((key) => label(key));
      const positions = rows.map((row) => texts.indexOf(row));
      expect(positions.every((position) => position > 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(texts).toContain("其餘分類");
      expect(texts[texts.indexOf("其餘分類") + 1]).toBe("$70");
      expect(labelsOf(message)).toEqual(["明細", "分析", "說明"]);
      // The footer button still opens the ledger itself.
      expect(uriActionsOf(message).map((action) => action.uri)).toEqual([
        "https://equo-mu.vercel.app/group/ledger_1?openExternalBrowser=1",
      ]);
    });

    // [MV]: pass no context into handleMonth and the categories are labelled with the zh catalog for an English user.
    test("an English-locale user sees the categories in English", async () => {
      const { client } = createLineFakeClient({
        line_context: () => ({ ...LINKED_CONTEXT, locale: "en" }),
        line_month_summary: summary({ categories: FIXTURE_CATEGORIES }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "month" })]);

      const texts = cardTexts(lastMessage(line));
      expect(texts).toContain("Food");
      expect(texts).toContain("Shopping");
      expect(texts).toContain("Other categories");
      expect(texts).not.toContain("餐飲");
    });

    test("a database that returns no breakdown gets a card with no by-category section, and no claim of no spending", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_month_summary: summary({}, { expense_minor: 0, income_minor: 0 }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "本月" })]);

      const message = lastMessage(line);
      expect(message.type).toBe("flex");
      expect(cardTexts(message)).not.toContain(ZH_HANT.cardByCategory);
      expect(cardTexts(message)).not.toContain(ZH_HANT.cardNoSpending);
    });

    test("an empty breakdown for an empty month says so", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_month_summary: summary({ categories: [] }, { expense_minor: 0, income_minor: 0 }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "本月" })]);

      expect(cardTexts(lastMessage(line))).toContain(ZH_HANT.cardNoSpending);
    });

    test("a breakdown made of junk is skipped entry by entry and never fails the reply", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_month_summary: summary({
          categories: [null, "food", { category: 7, expense_minor: 5 }, { category: "food", expense_minor: "5" }, { category: "food", expense_minor: 30000 }],
        }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "本月" })]);

      const message = lastMessage(line);
      expect(message.type).toBe("flex");
      expect(cardTexts(message)).toContain(label("food"));
    });

    test("a breakdown that is not a list at all is treated as absent", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_month_summary: summary({ categories: { food: 1 } }),
      });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "本月" })]);

      expect(lastMessage(line).type).toBe("flex");
      expect(cardTexts(lastMessage(line))).not.toContain(ZH_HANT.cardByCategory);
    });
  });

  describe("預算", () => {
    test("setting a budget is a card; the altText is today's text and the quick replies are the standard four", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

      const message = lastMessage(line);
      expect(message.type).toBe("flex");
      expect(plainTextOf(message)).toBe("每月預算已設為 $15,000。\n本月已花 $6,000，還剩 $9,000");
      expect(labelsOf(message)).toEqual(["本月", "明細", "分析", "說明"]);
      expect(cardTexts(message)).toContain(ZH_HANT.cardBudgetSetTitle);
    });

    test("viewing a budget is a card; with none it is the plain how-to text", async () => {
      let budget: number | null = 1_500_000;
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_month_summary: () => ({
          ok: true,
          ledger_id: "ledger_1",
          currency: "TWD",
          budget_minor: budget,
          month: { expense_minor: 600_000, income_minor: 0 },
        }),
      });
      const line = fakeLineClient();
      const d = cardDeps(client, line.client);

      await send(d, [messageEvent({ text: "預算" })]);
      expect(lastMessage(line).type).toBe("flex");
      expect(cardTexts(lastMessage(line))).toContain(ZH_HANT.cardBudgetShowTitle);

      budget = null;
      await send(d, [messageEvent({ text: "預算" })]);
      expect(lastMessage(line)).toMatchObject({ type: "text", text: ZH_HANT.budgetNone });
    });

    test("「取消預算」 stays a plain text", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();

      await send(cardDeps(client, line.client), [messageEvent({ text: "取消預算" })]);

      expect(lastMessage(line)).toMatchObject({ type: "text", text: ZH_HANT.budgetCleared });
    });
  });

  // [MV]: put a 復原 message button in any card and the validator's uri-only rule and this test both go red.
  test("no card carries an action that writes: every action opens a URL - except the record card's 刪除, which only ASKS - and 復原 appears only as a quick reply", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_month_summary: () => ({
        ok: true,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: 1_500_000,
        month: { expense_minor: 126_500, income_minor: 5_200_000 },
        categories: [{ category: "food", expense_minor: 30000 }],
      }),
    });
    const line = fakeLineClient();
    const d = cardDeps(client, line.client);

    for (const [index, text] of ["早餐 60", "+52000 薪水", "本月", "預算", "預算 15000", "說明"].entries()) {
      await send(d, [messageEvent({ text, webhookEventId: `01J000000000000000000000${index}` })]);
    }

    const cards = line.calls.reply.flatMap((call) => call.messages).filter((message) => message.type === "flex");
    // Two records are two cards each (the record card and its mood card), then month, budget x2 and help.
    expect(cards).toHaveLength(8);
    for (const card of cards) {
      expect(JSON.stringify(actionsOf(card))).not.toContain("復原");
      for (const action of actionsOf(card)) {
        if (action.type === "postback") {
          expect(parseLinePostback(action.data)?.action).toBe("delete_ask");
          continue;
        }
        expect(action.type).toBe("uri");
      }
      // The help card teaches the word 復原 as text; no other card has any reason to say it.
      if (!cardTexts(card).includes(ZH_HANT.helpCardTitle)) {
        expect(JSON.stringify((card as { contents: unknown }).contents)).not.toContain("復原");
      }
    }
    // ... and the one place it does appear is under the mood cards (the last message of a record) - while the record cards are the only ones with a postback, one each.
    expect(cards.filter((card) => labelsOf(card).includes("復原"))).toHaveLength(2);
    expect(cards.map((card) => postbacksOf(card).length)).toEqual([1, 0, 1, 0, 0, 0, 0, 0]);
  });

  describe("when LINE refuses the card", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
    const logged = () => [...errorSpy.mock.calls, ...warnSpy.mock.calls].map((call) => call.join(" ")).join("\n");

    // [MV]: drop the quick reply from the fallback and the buttons under the plain reply disappear.
    test("the entry is already saved; the resend is today's text with the very same quick replies, and the log has no title", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: recordWithBudget({ expense_minor: 606_000, income_minor: 0 }),
      });
      const line = fakeLineClient({ failStatuses: [400] });

      const result = await send(cardDeps(client, line.client), [messageEvent({ text: "早餐 60", replyToken: "rt-secret" })]);

      expect(result.status).toBe(200);
      expect(client.calls.filter((call) => call.op === "rpc" && call.fn === "line_record_entry")).toHaveLength(1);
      expect(line.calls.reply).toHaveLength(2);
      const [first, second] = line.calls.reply;
      expect(first.messages.map((m) => m.type)).toEqual(["flex", "flex"]);
      expect(second.replyToken).toBe("rt-secret");
      // Both messages come back as text, and the shortcuts are under the second one only.
      expect(second.messages).toHaveLength(2);
      expect(second.messages[0]).toEqual({ type: "text", text: "已記下支出：早餐 $60（餐飲）\n本月支出 $6,060，預算剩 $8,940" });
      expect(second.messages[1]).toMatchObject({ type: "text", quickReply: first.messages[1].quickReply });
      expect((second.messages[1] as { text: string }).text).toContain("連續記帳 3 天");
      expect(labelsOf(second.messages[1])).toEqual(["復原", "本月", "明細", "分析"]);

      expect(logged()).toContain("[line] flex reply rejected (status 400; cards: record, mood), resending as text");
      expect(logged()).toContain("[line] text fallback delivered (cards: record, mood)");
      expect(logged()).not.toContain("早餐");
      expect(logged()).not.toContain("rt-secret");
      expect(logged()).not.toContain(LINE_USER_ID);
    });

    test("the month card falls back to the month text, and the budget card to the budget text", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient({ failStatuses: [400, null, 400] });

      await send(cardDeps(client, line.client), [messageEvent({ text: "本月" })]);
      await send(cardDeps(client, line.client), [messageEvent({ text: "預算 15000", webhookEventId: "01J0000000000000000000000Q" })]);

      // reply 1: month card refused; 2: month text; 3: budget card refused; 4: budget text.
      expect(line.calls.reply.map((call) => call.messages[0].type)).toEqual(["flex", "text", "flex", "text"]);
      expect(labelsOf(line.calls.reply[1].messages[0])).toEqual(["明細", "分析", "說明"]);
      expect(plainTextOf(line.calls.reply[3].messages[0])).toBe("每月預算已設為 $15,000。\n本月已花 $6,000，還剩 $9,000");
      expect(labelsOf(line.calls.reply[3].messages[0])).toEqual(["本月", "明細", "分析", "說明"]);
    });

    // [MV]: drop the `message !== null` filter in safeReply and this reply is sent twice, identical both times.
    test("cards that could not be built went out as text already: a 400 on them is not retried", async () => {
      cardFaults.recordCard = true;
      cardFaults.moodCard = true;
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: recordWithBudget({ expense_minor: 606_000, income_minor: 0 }),
      });
      const line = fakeLineClient({ failStatuses: [400] });

      const result = await send(cardDeps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      expect(result.status).toBe(200);
      expect(line.calls.reply).toHaveLength(1);
      expect(line.calls.reply[0].messages.map((m) => m.type)).toEqual(["text", "text"]);
      expect(logged()).toContain("[line] card build failed (record)");
      expect(logged()).toContain("[line] card build failed (mood)");
      expect(logged()).toContain("[line] reply failed: LINE API request failed with status 400");
      expect(logged()).not.toContain("flex reply rejected");
    });

    // [MV]: retry on any error, not just a LineApiError 400, and a timed-out reply is sent twice - LINE may have delivered the first.
    test("a timeout is not a card problem: one call, no resend", async () => {
      const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: recordWithBudget({ expense_minor: 606_000, income_minor: 0 }),
      });
      const line = fakeLineClient({ failStatuses: [timeout] });

      const result = await send(cardDeps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      expect(result.status).toBe(200);
      expect(line.calls.reply).toHaveLength(1);
      expect(line.calls.reply[0].messages[0].type).toBe("flex");
      expect(logged()).toContain("[line] reply failed: The operation was aborted due to timeout");
      expect(logged()).not.toContain("flex reply rejected");
    });
  });
});

describe("handleLineWebhook - welcome, link and linked cards", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const followEvent = (opts: { isUnblocked?: boolean; replyToken?: string } = {}) => ({
    type: "follow",
    mode: "active",
    timestamp: 1790000000000,
    webhookEventId: "01J0000000000000000000000F",
    replyToken: opts.replyToken ?? "rt4",
    source: { type: "user", userId: LINE_USER_ID },
    follow: { isUnblocked: opts.isUnblocked ?? false },
  });
  const textsOfCard = (message: LineMessage): string[] => {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;
        if (record.type === "text") found.push(record.text as string);
        Object.values(record).forEach(walk);
      }
    };
    if (message.type === "flex") walk(message.contents);
    return found;
  };
  const heroOf = (message: LineMessage) => (message.type === "flex" ? message.contents.hero : undefined);
  const lastMessages = (line: ReturnType<typeof fakeLineClient>) => line.calls.reply.at(-1)!.messages;

  describe("following", () => {
    // [MV]: the card replaces TWO messages with one; the fallback must put both back.
    test("an unlinked follower gets ONE card: welcome title, the greeting, the banner and the link button", async () => {
      const { client } = createLineFakeClient();
      const line = fakeLineClient();
      line.setIssuedToken("linktoken123");

      await send(deps(client, line.client), [followEvent()]);

      expect(line.calls.reply).toHaveLength(1);
      const messages = lastMessages(line);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("flex");
      expect(plainTextOf(messages[0])).toBe(ZH_HANT.welcome);
      expect(messages[0].quickReply).toBeUndefined();

      const texts = textsOfCard(messages[0]);
      expect(texts).toEqual([ZH_HANT.welcomeCardTitle, ZH_HANT.welcome, ZH_HANT.linkPrompt]);
      expect(heroOf(messages[0])).toMatchObject({ url: `${APP_ORIGIN}/assets/line/link-hero-v1.jpg` });

      const uris = uriActionsOf(messages[0]).map((action) => action.uri);
      expect(uris).toHaveLength(1);
      expect(uris[0]).toContain("/line/link?linkToken=linktoken123");
      expect(uris[0]).toContain("openExternalBrowser=1");
    });

    test("re-following after an unblock, still not linked, leads with welcomeBack", async () => {
      const { client } = createLineFakeClient();
      const line = fakeLineClient();

      await send(deps(client, line.client), [followEvent({ isUnblocked: true })]);

      expect(lastMessages(line)).toHaveLength(1);
      expect(plainTextOf(lastMessages(line)[0])).toBe(ZH_HANT.welcomeBack);
      expect(textsOfCard(lastMessages(line)[0])).toContain(ZH_HANT.welcomeCardTitle);
    });

    test("a disabled English account that follows gets the English welcome card", async () => {
      const { client } = createLineFakeClient({ line_context: () => ({ ...LINKED_CONTEXT, disabled: true, locale: "en" }) });
      const line = fakeLineClient();

      await send(deps(client, line.client), [followEvent()]);

      expect(plainTextOf(lastMessages(line)[0])).toBe(EN.welcome);
      expect(textsOfCard(lastMessages(line)[0])).toEqual([EN.welcomeCardTitle, EN.welcome, EN.linkPrompt]);
    });

    test("an already-linked follower is told welcome back in plain text, and no link is issued", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();

      await send(deps(client, line.client), [followEvent()]);

      expect(lastMessages(line)).toHaveLength(1);
      expect(lastMessages(line)[0]).toMatchObject({ type: "text", text: ZH_HANT.welcomeBack });
      expect(lastMessages(line)[0].quickReply?.items.map((item) => item.action.label)).toEqual(["本月", "明細", "分析", "說明"]);
      expect(line.calls.issueLinkToken).toHaveLength(0);
    });

    test("when no link can be issued there is no button to draw: the greeting, then linkUnavailable, as plain text", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const { client } = createLineFakeClient();
        const line = fakeLineClient({ issueLinkTokenFails: true });

        await send(deps(client, line.client), [followEvent()]);

        expect(lastMessages(line)).toEqual([
          { type: "text", text: ZH_HANT.welcome },
          { type: "text", text: ZH_HANT.linkUnavailable },
        ]);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("an unlinked user's message", () => {
    test("gets the standalone link card: the link title, no greeting lead, the altText is the link title", async () => {
      const { client } = createLineFakeClient();
      const line = fakeLineClient();

      await send(deps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      const messages = lastMessages(line);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("flex");
      expect(plainTextOf(messages[0])).toBe(ZH_HANT.linkAltText);
      expect(textsOfCard(messages[0])).toEqual([ZH_HANT.linkCardTitle, ZH_HANT.linkPrompt]);
      expect(uriActionsOf(messages[0])).toHaveLength(1);
    });

    test("asking for help gets the help card and then the link card, in that order", async () => {
      const { client } = createLineFakeClient();
      const line = fakeLineClient();

      await send(deps(client, line.client), [messageEvent({ text: "說明" })]);

      const messages = lastMessages(line);
      expect(messages.map((message) => plainTextOf(message))).toEqual([fill(ZH_HANT.help, { minutes: 30 }), ZH_HANT.linkAltText]);
      expect(messages.map((message) => message.type)).toEqual(["flex", "flex"]);
    });
  });

  describe("linking from the link page", () => {
    // [MV]: put the raw address on the card and this goes red.
    test("accountLink ok sends the linked card; only the masked address ever appears", async () => {
      const { client } = createLineFakeClient({
        line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "zh-Hant" }),
      });
      const line = fakeLineClient();

      await send(deps(client, line.client), [accountLinkEvent()]);

      const messages = lastMessages(line);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("flex");
      expect(plainTextOf(messages[0])).toBe(fill(ZH_HANT.linked, { email: "al***@example.com" }));
      expect(textsOfCard(messages[0])).toContain("al***@example.com");
      expect(JSON.stringify(messages)).not.toContain("alice@example.com");
      expect(JSON.stringify(messages)).toContain(ZH_HANT.linkedCardTitle);
    });

    test("an English account gets the English linked card", async () => {
      const { client } = createLineFakeClient({
        line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "en" }),
      });
      const line = fakeLineClient();

      await send(deps(client, line.client), [accountLinkEvent()]);

      expect(plainTextOf(lastMessages(line)[0])).toBe(fill(EN.linked, { email: "al***@example.com" }));
      expect(textsOfCard(lastMessages(line)[0])).toEqual(expect.arrayContaining([EN.linkedCardTitle, EN.linkedCardHint]));
    });

    test("a nonce that does not check out gets the link card again, led by linkFailed", async () => {
      const { client } = createLineFakeClient({ line_consume_link_nonce: () => ({ ok: false, reason: "expired" }) });
      const line = fakeLineClient();

      await send(deps(client, line.client), [accountLinkEvent()]);

      const messages = lastMessages(line);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("flex");
      expect(plainTextOf(messages[0])).toBe(ZH_HANT.linkFailed);
      expect(textsOfCard(messages[0])).toEqual([ZH_HANT.linkCardTitle, ZH_HANT.linkFailed, ZH_HANT.linkPrompt]);
      expect(uriActionsOf(messages[0])).toHaveLength(1);
    });
  });

  describe("when LINE refuses the card", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    // [MV]: give the link card a plain-text fallback and the person is left with no way to link.
    test("the link card's fallback is the buttons template, opening the very same link", async () => {
      const { client } = createLineFakeClient();
      const line = fakeLineClient({ failStatuses: [400] });
      line.setIssuedToken("linktoken123");

      await send(deps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      expect(line.calls.reply).toHaveLength(2);
      const [first, second] = line.calls.reply;
      expect(first.messages.map((message) => message.type)).toEqual(["flex"]);
      expect(second.messages).toHaveLength(1);
      const template = second.messages[0];
      expect(template.type).toBe("template");
      expect(template).toMatchObject({
        altText: ZH_HANT.linkAltText,
        template: { type: "buttons", text: ZH_HANT.linkPrompt },
      });
      expect(uriActionsOf(template).map((action) => action.uri)).toEqual(uriActionsOf(first.messages[0]).map((action) => action.uri));
      expect(uriActionsOf(template)[0].uri).toContain("openExternalBrowser=1");
      expect(errorSpy.mock.calls.map((call) => call.join(" "))).toEqual([
        "[line] flex reply rejected (status 400; cards: link), resending as text",
      ]);
      expect(warnSpy.mock.calls.map((call) => call.join(" "))).toEqual(["[line] text fallback delivered (cards: link)"]);
    });

    test("the welcome card's fallback is today's pair: the greeting as text, then the buttons template", async () => {
      const { client } = createLineFakeClient();
      const line = fakeLineClient({ failStatuses: [400] });

      await send(deps(client, line.client), [followEvent()]);

      const [first, second] = line.calls.reply;
      expect(first.messages.map((message) => message.type)).toEqual(["flex"]);
      expect(second.messages.map((message) => message.type)).toEqual(["text", "template"]);
      expect(second.messages[0]).toEqual({ type: "text", text: ZH_HANT.welcome });
      expect(uriActionsOf(second.messages[1])).toEqual(uriActionsOf(first.messages[0]));
    });

    test("the linked card's fallback is today's one-line confirmation", async () => {
      const { client } = createLineFakeClient({
        line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "zh-Hant" }),
      });
      const line = fakeLineClient({ failStatuses: [400] });

      await send(deps(client, line.client), [accountLinkEvent()]);

      expect(line.calls.reply).toHaveLength(2);
      expect(line.calls.reply[1].messages).toEqual([
        { type: "text", text: fill(ZH_HANT.linked, { email: "al***@example.com" }), quickReply: line.calls.reply[0].messages[0].quickReply },
      ]);
      expect(line.calls.reply[1].messages[0].quickReply?.items.map((item) => item.action.label)).toEqual(["本月", "說明"]);
      expect(JSON.stringify([errorSpy.mock.calls, warnSpy.mock.calls])).not.toContain("alice");
    });
  });
});

describe("handleLineWebhook - the quick reply under each reply", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const dateDeps = (client: FakePostgrest, line: LineClient): LineWebhookDeps => ({ ...deps(client, line), now: () => 1790000000000 });
  const lastReply = (line: ReturnType<typeof fakeLineClient>) => line.calls.reply.at(-1)!.messages;
  const labels = (message: LineMessage | undefined) => (message?.quickReply?.items ?? []).map((item) => item.action.label);
  const RECORDS = "https://equo-mu.vercel.app/group/ledger_1?view=records&openExternalBrowser=1";
  const ANALYSIS = "https://equo-mu.vercel.app/group/ledger_1?view=analysis&openExternalBrowser=1";
  const STANDARD = ["本月", "明細", "分析", "說明"];

  async function replyTo(text: string, overrides: Partial<Record<string, (args: Record<string, unknown>) => unknown>> = {}, context: unknown = LINKED_CONTEXT) {
    resetSiteNoticeCache(); // the maintenance flag is cached for 30 seconds, across the calls of one test
    const { client } = createLineFakeClient({ line_context: () => context, ...overrides });
    const line = fakeLineClient();
    await send(dateDeps(client, line.client), [messageEvent({ text })]);
    return lastReply(line);
  }

  // [MV]: the table of the plan's §4.4, one row per reply.
  test.each([
    ["a parse error (notUnderstood)", "亂七八糟", ZH_HANT.notUnderstood],
    ["a missing title", "60", ZH_HANT.missingTitle],
    ["a budget with nothing set", "預算", ZH_HANT.budgetNone],
    ["a cleared budget", "取消預算", ZH_HANT.budgetCleared],
    ["an already-linked reminder", "綁定", undefined],
  ])("%s carries the standard quick reply", async (_name, text, expectedText) => {
    const messages = await replyTo(text, {
      line_month_summary: () => ({ ok: true, ledger_id: "ledger_1", currency: "TWD", budget_minor: null, month: { expense_minor: 0, income_minor: 0 } }),
    });

    expect(messages).toHaveLength(1);
    expect(labels(messages[0])).toEqual(STANDARD);
    if (expectedText !== undefined) expect(plainTextOf(messages[0])).toBe(expectedText);
    expect(messages[0].quickReply?.items[1].action).toMatchObject({ type: "uri", uri: RECORDS });
    expect(messages[0].quickReply?.items[2].action).toMatchObject({ type: "uri", uri: ANALYSIS });
  });

  test("the undo results (undone, nothing to undo, already gone) carry the standard quick reply; a failure does not", async () => {
    const undone = await replyTo("復原");
    expect(labels(undone[0])).toEqual(STANDARD);

    const nothing = await replyTo("復原", { line_undo_last: () => ({ ok: false, reason: "nothing_to_undo" }) });
    expect(plainTextOf(nothing[0])).toContain("沒有可以復原");
    expect(labels(nothing[0])).toEqual(STANDARD);

    const gone = await replyTo("復原", { line_undo_last: () => ({ ok: false, reason: "already_gone" }) });
    expect(plainTextOf(gone[0])).toBe(ZH_HANT.undoAlreadyGone);
    expect(labels(gone[0])).toEqual(STANDARD);

    const failed = await replyTo("復原", { line_undo_last: () => ({ ok: false, reason: "not_linked" }) });
    expect(plainTextOf(failed[0])).toBe(ZH_HANT.genericError);
    expect(failed[0].quickReply).toBeUndefined();
  });

  test("a linked user with no ledger yet gets 本月 and 說明 but no links", async () => {
    const messages = await replyTo("亂七八糟", {}, { ...LINKED_CONTEXT, ledger: null });
    expect(labels(messages[0])).toEqual(["本月", "說明"]);
  });

  test("English labels and texts for an English account", async () => {
    const messages = await replyTo("asdf qwer", {}, { ...LINKED_CONTEXT, locale: "en" });
    expect(labels(messages[0])).toEqual(["This month", "Records", "Insights", "Help"]);
    expect(messages[0].quickReply?.items.map((item) => item.action)).toMatchObject([
      { type: "message", text: "month" },
      { type: "uri", uri: RECORDS },
      { type: "uri", uri: ANALYSIS },
      { type: "message", text: "help" },
    ]);
  });

  test("replies that are not answers carry no quick reply: maintenance, rate limit, disabled account, generic error, unlink", async () => {
    const maintenance = await replyTo("早餐 60", {
      site_notice_settings: () => ({
        banner: { message: "", level: "info", ends_at: null, active: false },
        maintenance: { enabled: true, message: "" },
      }),
    });
    expect(maintenance[0].quickReply).toBeUndefined();

    const rateLimited = await replyTo("早餐 60", { consume_rate_limit: () => ({ allowed: false, retry_after: 5 }) });
    expect(rateLimited[0].quickReply).toBeUndefined();

    const disabled = await replyTo("早餐 60", {}, { ...LINKED_CONTEXT, disabled: true });
    expect(disabled[0].quickReply).toBeUndefined();

    const broken = await replyTo("早餐 60", {
      line_record_entry: () => ({ ok: false, reason: "failed" }),
    });
    expect(plainTextOf(broken[0])).toBe(ZH_HANT.genericError);
    expect(broken[0].quickReply).toBeUndefined();

    const unlinked = await replyTo("解除綁定");
    expect(plainTextOf(unlinked[0])).toBe(ZH_HANT.unlinked);
    expect(unlinked[0].quickReply).toBeUndefined();
  });

  test("an unlinked user's link card carries none either", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    await send(deps(client, line.client), [messageEvent({ text: "早餐 60" })]);
    expect(lastReply(line)[0].quickReply).toBeUndefined();
  });
});

describe("handleLineWebhook - the record card's 編輯 / 刪除 and the delete flow", () => {
  const KEY = "01J0000000000000000000000X";
  const CONFIRM_EVENT = "01J0000000000000000000000Q";
  const ASK_DATA = encodeLinePostback({ action: "delete_ask", entryKey: KEY });
  const CONFIRM_DATA = encodeLinePostback({ action: "delete_confirm", entryKey: KEY });
  const CANCEL_DATA = encodeLinePostback({ action: "delete_cancel" });
  const STANDARD = ["本月", "明細", "分析", "說明"];
  const MAINTENANCE_ON = () => ({
    banner: { message: "", level: "info", ends_at: null, active: false },
    maintenance: { enabled: true, message: "" },
  });

  function postbackEvent(
    opts: {
      data?: unknown;
      webhookEventId?: string | null;
      userId?: string;
      replyToken?: string;
      sourceType?: "user" | "group" | "room";
      mode?: string;
      params?: Record<string, string>;
    } = {},
  ) {
    return {
      type: "postback",
      mode: opts.mode ?? "active",
      timestamp: 1790000000000,
      ...(opts.webhookEventId === null ? {} : { webhookEventId: opts.webhookEventId ?? CONFIRM_EVENT }),
      deliveryContext: { isRedelivery: false },
      replyToken: opts.replyToken ?? "rt-pb",
      source:
        opts.sourceType === "group"
          ? { type: "group", groupId: "G1", userId: opts.userId ?? LINE_USER_ID }
          : opts.sourceType === "room"
            ? { type: "room", roomId: "R1", userId: opts.userId ?? LINE_USER_ID }
            : { type: "user", userId: opts.userId ?? LINE_USER_ID },
      postback: { data: opts.data, ...(opts.params ? { params: opts.params } : {}) },
    };
  }

  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const dateDeps = (client: FakePostgrest, line: LineClient): LineWebhookDeps => ({ ...deps(client, line), now: () => 1790000000000 });
  const labels = (message: LineMessage | undefined) => (message?.quickReply?.items ?? []).map((item) => item.action.label);
  const rpcNames = (client: FakePostgrest) =>
    client.calls.filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc").map((c) => c.fn);
  const deleteRpcs = (client: FakePostgrest) => rpcNames(client).filter((fn) => fn === "line_entry_status" || fn === "line_delete_entry");

  /** One postback in, everything that came out. The maintenance flag is cached for 30 s, so each call starts clean. */
  async function tap(
    data: unknown,
    overrides: Partial<Record<string, RpcHandler>> = {},
    options: { context?: unknown; event?: Parameters<typeof postbackEvent>[0] } = {},
  ) {
    resetSiteNoticeCache();
    const { client } = createLineFakeClient({
      line_context: () => ("context" in options ? options.context : LINKED_CONTEXT),
      ...overrides,
    });
    const line = fakeLineClient();
    await send(dateDeps(client, line.client), [postbackEvent({ ...options.event, data })]);
    return { client, line, messages: line.calls.reply.at(-1)?.messages ?? [] };
  }

  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("the record card", () => {
    const record = async (eventOpts: Parameters<typeof messageEvent>[0] = {}, messageId = "1") => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();
      const event = messageEvent({ text: "早餐 60", ...eventOpts });
      await send(dateDeps(client, line.client), [{ ...event, message: { ...event.message, id: messageId } }]);
      return { client, line, message: line.calls.reply[0].messages[0] };
    };

    // [MV]: 編輯 pointing at another key, or 刪除 naming one, and this goes red.
    test("its 編輯 opens THE entry that was recorded and its 刪除 asks to delete THAT entry - one key for all three", async () => {
      const { client, message } = await record();
      const recordedAs = client.rpcCall("line_record_entry")?.args.p_event_id;

      expect(recordedAs).toBe(KEY);
      expect(uriActionsOf(message)).toEqual([
        { type: "uri", label: "編輯", uri: `${APP_ORIGIN}/group/ledger_1?entry=${KEY}&openExternalBrowser=1` },
      ]);
      const postbacks = postbacksOf(message);
      expect(postbacks).toHaveLength(1);
      expect(postbacks[0]).toMatchObject({ label: "刪除", displayText: "刪除這筆" });
      expect(parseLinePostback(postbacks[0].data)).toEqual({ action: "delete_ask", entryKey: recordedAs });
    });

    test("when LINE's event has no usable id the key is the message id, in the card and in the record alike", async () => {
      const { client, message } = await record({ webhookEventId: "short" }, "4711000000001");

      expect(client.rpcCall("line_record_entry")?.args.p_event_id).toBe("msg:4711000000001");
      expect(uriActionsOf(message)[0].uri).toBe(`${APP_ORIGIN}/group/ledger_1?entry=msg%3A4711000000001&openExternalBrowser=1`);
      expect(parseLinePostback(postbacksOf(message)[0].data)).toEqual({ action: "delete_ask", entryKey: "msg:4711000000001" });
    });

    // The key must fit the 8-80 grammar to be a button at all; one that cannot costs the buttons, never the record.
    test("a key too short to be a button (never a real LINE id) still records, as plain text with the same shortcuts", async () => {
      const { client, line, message } = await record({ webhookEventId: "short" }, "1");
      const [, mood] = line.calls.reply[0].messages;

      expect(client.rpcCall("line_record_entry")?.args.p_event_id).toBe("msg:1");
      expect(message.type).toBe("text");
      expect(JSON.stringify(message)).not.toContain("postback");
      expect(labels(message)).toEqual([]);
      // The mood card is not about the key: it is still there, and it still carries the shortcuts.
      expect(mood.type).toBe("flex");
      expect(labels(mood)).toEqual(["復原", "本月", "明細", "分析"]);
    });

    // [MV]: a postback in the text fallback is a button nobody can tap - and one that would be handled if they could.
    test("when LINE refuses the card, the text that goes out has the same shortcuts and no postback at all", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient({ failStatuses: [400] });
      await send(dateDeps(client, line.client), [messageEvent({ text: "早餐 60" })]);

      expect(line.calls.reply).toHaveLength(2);
      const [first, retry] = line.calls.reply;
      expect(first.messages[0].type).toBe("flex");
      expect(retry.replyToken).toBe(first.replyToken);
      expect(retry.messages.map((m) => m.type)).toEqual(["text", "text"]);
      expect(JSON.stringify(retry.messages)).not.toContain("postback");
      expect(labels(retry.messages[0])).toEqual([]);
      expect(labels(retry.messages[1])).toEqual(["復原", "本月", "明細", "分析"]);
    });

    // [MV]: the shortcuts sit on the LAST message of the reply (the mood card), so LINE keeps them.
    test("the shortcuts are on the last message of the record reply, and on no other", async () => {
      const { line } = await record();
      const messages = line.calls.reply[0].messages;
      expect(messages).toHaveLength(2);
      expect(messages.slice(0, -1).every((m) => m.quickReply === undefined)).toBe(true);
      expect(labels(messages.at(-1))).toEqual(["復原", "本月", "明細", "分析"]);
    });
  });

  describe("asking (the card's 刪除)", () => {
    // [MV]: if the ask deleted, the entry would be gone before the person said yes.
    test("looks the entry up for the sender, writes nothing, and asks with 確定刪除 / 取消 for that same key", async () => {
      const { client, messages, line } = await tap(ASK_DATA);

      expect(deleteRpcs(client)).toEqual(["line_entry_status"]);
      expect(client.rpcCall("line_entry_status")?.args).toEqual({ p_line_user_id: LINE_USER_ID, p_entry_key: KEY });
      expect(line.calls.reply).toHaveLength(1);
      expect(line.calls.reply[0].replyToken).toBe("rt-pb");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ type: "text", text: "確定刪除『早餐 $60』？" });

      expect(messages[0].quickReply?.items.map((item) => item.action)).toEqual([
        { type: "postback", label: "確定刪除", data: CONFIRM_DATA, displayText: "確定刪除" },
        { type: "postback", label: "取消", data: CANCEL_DATA, displayText: "取消" },
      ]);
    });

    test("an entry edited in the app since the card was made says so, with what it is now", async () => {
      const { messages } = await tap(ASK_DATA, {
        line_entry_status: () => ({
          ok: true,
          status: "live",
          edited: true,
          expense: { ...ENTRY_SNAPSHOT, title: "午餐", amount_minor: 12000 },
        }),
      });
      expect(messages[0]).toMatchObject({ text: "這筆在 App 裡改過了，現在是『午餐 $120』。確定刪除？" });
      expect(labels(messages[0])).toEqual(["確定刪除", "取消"]);
    });

    test("an entry that is already deleted, or never was this person's, is said so - with the standard shortcuts and no confirm", async () => {
      const gone = await tap(ASK_DATA, { line_entry_status: () => ({ ok: true, status: "gone" }) });
      expect(gone.messages[0]).toMatchObject({ type: "text", text: ZH_HANT.deleteAlreadyGone });
      expect(labels(gone.messages[0])).toEqual(STANDARD);

      const missing = await tap(ASK_DATA, { line_entry_status: () => ({ ok: true, status: "not_found" }) });
      expect(missing.messages[0]).toMatchObject({ type: "text", text: ZH_HANT.deleteNotFound });
      expect(labels(missing.messages[0])).toEqual(STANDARD);
      expect(JSON.stringify(missing.messages)).not.toContain("postback");
    });

    test("an English account is asked in English", async () => {
      const { messages } = await tap(
        ASK_DATA,
        { line_entry_status: () => ({ ok: true, status: "live", edited: false, expense: { ...ENTRY_SNAPSHOT, title: "Breakfast" } }) },
        { context: { ...LINKED_CONTEXT, locale: "en" } },
      );
      expect(messages[0]).toMatchObject({ text: 'Delete "Breakfast $60"?' });
      expect(labels(messages[0])).toEqual(["Delete", "Cancel"]);
    });

    test("an account that stopped being linked, or was disabled, between the card and the tap gets the answer any message would", async () => {
      const unlinked = await tap(ASK_DATA, { line_entry_status: () => ({ ok: false, reason: "not_linked" }) });
      expect(unlinked.line.calls.issueLinkToken).toEqual([LINE_USER_ID]);

      const disabled = await tap(ASK_DATA, { line_entry_status: () => ({ ok: false, reason: "account_disabled" }) });
      expect(disabled.messages[0]).toMatchObject({ type: "text", text: ZH_HANT.accountDisabled });
    });
  });

  describe("confirming (確定刪除)", () => {
    // [MV]: key the delete on the CARD's event instead of this tap's and a redelivery cannot be told from a second delete.
    test("deletes the entry the data names, for the sender, keyed on THIS tap's event id", async () => {
      const { client, messages } = await tap(CONFIRM_DATA);

      expect(deleteRpcs(client)).toEqual(["line_delete_entry"]);
      expect(client.rpcCall("line_delete_entry")?.args).toEqual({
        p_line_user_id: LINE_USER_ID,
        p_entry_key: KEY,
        p_event_id: CONFIRM_EVENT,
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ type: "text", text: "已刪除：早餐 $60" });
      expect(labels(messages[0])).toEqual(STANDARD);
      expect(JSON.stringify(messages)).not.toContain("postback");
    });

    test("LINE delivering the same tap twice: both deliveries use one event id and both are answered 已刪除", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_delete_entry: (args) => ({ ok: true, replay: args.p_event_id === CONFIRM_EVENT && seen++ > 0, expense: ENTRY_SNAPSHOT }),
      });
      let seen = 0;
      const line = fakeLineClient();
      const d = dateDeps(client, line.client);

      await send(d, [postbackEvent({ data: CONFIRM_DATA })]);
      await send(d, [postbackEvent({ data: CONFIRM_DATA })]);

      const eventIds = client.calls.filter((c) => c.op === "rpc" && c.fn === "line_delete_entry").map((c) => (c as { args: Record<string, unknown> }).args.p_event_id);
      expect(eventIds).toEqual([CONFIRM_EVENT, CONFIRM_EVENT]);
      expect(line.calls.reply.map((call) => plainTextOf(call.messages[0]))).toEqual(["已刪除：早餐 $60", "已刪除：早餐 $60"]);
    });

    test("an entry someone already deleted, or one that is not this person's, is told so", async () => {
      const gone = await tap(CONFIRM_DATA, { line_delete_entry: () => ({ ok: false, reason: "already_gone" }) });
      expect(gone.messages[0]).toMatchObject({ text: ZH_HANT.deleteAlreadyGone });
      expect(labels(gone.messages[0])).toEqual(STANDARD);

      const missing = await tap(CONFIRM_DATA, { line_delete_entry: () => ({ ok: false, reason: "not_found" }) });
      expect(missing.messages[0]).toMatchObject({ text: ZH_HANT.deleteNotFound });
    });

    test("not linked / disabled answers as any other message would", async () => {
      const unlinked = await tap(CONFIRM_DATA, { line_delete_entry: () => ({ ok: false, reason: "not_linked" }) });
      expect(unlinked.line.calls.issueLinkToken).toEqual([LINE_USER_ID]);

      const disabled = await tap(CONFIRM_DATA, { line_delete_entry: () => ({ ok: false, reason: "account_disabled" }) });
      expect(disabled.messages[0]).toMatchObject({ text: ZH_HANT.accountDisabled });
    });

    // [MV]: without the check a tap with no event key would be sent to the database with a made-up one.
    test("a tap with no usable event id deletes nothing and says something went wrong", async () => {
      const { client, messages } = await tap(CONFIRM_DATA, {}, { event: { webhookEventId: null } });

      expect(deleteRpcs(client)).toEqual([]);
      expect(messages[0]).toMatchObject({ type: "text", text: ZH_HANT.genericError });
    });

    test("an English account is told in English", async () => {
      const { messages } = await tap(
        CONFIRM_DATA,
        { line_delete_entry: () => ({ ok: true, replay: false, expense: { ...ENTRY_SNAPSHOT, title: "Breakfast" } }) },
        { context: { ...LINKED_CONTEXT, locale: "en" } },
      );
      expect(messages[0]).toMatchObject({ text: "Deleted: Breakfast $60" });
    });
  });

  describe("cancelling (取消)", () => {
    // [MV]: if cancel reached the database it would be a way to write by saying no.
    test("makes no call to the database and says nothing was deleted", async () => {
      const { client, messages } = await tap(CANCEL_DATA);

      expect(deleteRpcs(client)).toEqual([]);
      expect(messages[0]).toMatchObject({ type: "text", text: ZH_HANT.deleteCancelled });
      expect(labels(messages[0])).toEqual(STANDARD);
    });
  });

  describe("maintenance", () => {
    // [MV]: take the gate off the ask or the confirm and a person in maintenance is led to (or through) a write.
    test("blocks the ask and the confirm - no database call, the maintenance text - but not the cancel", async () => {
      const ask = await tap(ASK_DATA, { site_notice_settings: MAINTENANCE_ON });
      expect(deleteRpcs(ask.client)).toEqual([]);
      expect(ask.messages[0]).toMatchObject({ type: "text", text: ZH_HANT.maintenance });
      expect(ask.messages[0].quickReply).toBeUndefined();

      const confirm = await tap(CONFIRM_DATA, { site_notice_settings: MAINTENANCE_ON });
      expect(deleteRpcs(confirm.client)).toEqual([]);
      expect(confirm.messages[0]).toMatchObject({ type: "text", text: ZH_HANT.maintenance });

      const cancel = await tap(CANCEL_DATA, { site_notice_settings: MAINTENANCE_ON });
      expect(cancel.messages[0]).toMatchObject({ type: "text", text: ZH_HANT.deleteCancelled });
    });
  });

  describe("who may tap", () => {
    test("an unlinked user gets the link card and nothing is looked up", async () => {
      const { client, line } = await tap(ASK_DATA, {}, { context: null });

      expect(deleteRpcs(client)).toEqual([]);
      expect(line.calls.issueLinkToken).toEqual([LINE_USER_ID]);
      expect(line.calls.reply).toHaveLength(1);
    });

    test("a disabled account is told so and nothing is looked up", async () => {
      for (const data of [ASK_DATA, CONFIRM_DATA]) {
        const { client, messages } = await tap(data, {}, { context: { ...LINKED_CONTEXT, disabled: true } });
        expect(deleteRpcs(client)).toEqual([]);
        expect(messages[0]).toMatchObject({ text: ZH_HANT.accountDisabled });
      }
    });

    test("a rate-limited sender is told to slow down and nothing is looked up", async () => {
      const { client, messages } = await tap(CONFIRM_DATA, { consume_rate_limit: () => ({ allowed: false, retry_after: 5 }) });
      expect(deleteRpcs(client)).toEqual([]);
      expect(messages[0]).toMatchObject({ text: ZH_HANT.rateLimited });
    });

    // [MV]: answer a group's postback and the bot starts talking in groups.
    test.each(["group", "room"] as const)("a postback from a %s is ignored: no reply, no database call", async (sourceType) => {
      const { client, line } = await tap(CONFIRM_DATA, {}, { event: { sourceType } });
      expect(line.calls.reply).toEqual([]);
      expect(deleteRpcs(client)).toEqual([]);
      expect(rpcNames(client)).toEqual([]);
    });

    test("a postback in standby mode is ignored", async () => {
      const { client, line } = await tap(CONFIRM_DATA, {}, { event: { mode: "standby" } });
      expect(line.calls.reply).toEqual([]);
      expect(rpcNames(client)).toEqual([]);
    });

    // [MV]: read the user from the data or params and one person's button deletes another's entry.
    test("whose entry it is comes only from who tapped: the data has no user, and a params userId is not read", async () => {
      const other = "Uffffffffffffffffffffffffffffffff";
      const { client } = await tap(ASK_DATA, {}, { event: { params: { userId: other } } });

      expect(client.rpcCall("line_entry_status")?.args.p_line_user_id).toBe(LINE_USER_ID);
      expect(JSON.stringify(client.calls)).not.toContain(other);

      const smuggled = await tap(`${ASK_DATA}&u=${other}`);
      expect(deleteRpcs(smuggled.client)).toEqual([]);
    });
  });

  describe("data that is not ours", () => {
    const BAD: Array<[string, unknown]> = [
      ["missing", undefined],
      ["empty", ""],
      ["not a string", 42],
      ["garbage", "hello"],
      ["another version", "v=2&a=del&k=01J0000000000000000000000X"],
      ["an unknown action", "v=1&a=pay&k=01J0000000000000000000000X"],
      ["a key that is too short", "v=1&a=delok&k=abc"],
      ["a key with a path in it", "v=1&a=delok&k=..%2F..%2Fetc"],
      ["a trailing extra parameter", `${CONFIRM_DATA}&x=1`],
      ["a long string", `v=1&a=delok&k=${"a".repeat(400)}`],
    ];

    // [MV]: handle unknown data as a delete and anything could be sent to the database.
    test.each(BAD)("%s is answered 'that button no longer works': no database call, nothing of it logged", async (_name, data) => {
      const { client, messages } = await tap(data);

      expect(deleteRpcs(client)).toEqual([]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ type: "text", text: ZH_HANT.postbackExpired });
      expect(labels(messages[0])).toEqual(STANDARD);
      expect(warnSpy.mock.calls).toEqual([["[line] postback ignored (unknown data)"]]);
      if (typeof data === "string" && data.length > 3) expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(data);
    });

    test("an English account is told in English", async () => {
      const { messages } = await tap("hello", {}, { context: { ...LINKED_CONTEXT, locale: "en" } });
      expect(messages[0]).toMatchObject({ text: EN.postbackExpired });
    });
  });

  describe("when something throws", () => {
    // [MV]: a thrown RPC must reach the same catch every other event goes through, with no ids in the log.
    test("a failing database call is answered with the generic error and logs no user id, key or data", async () => {
      for (const data of [ASK_DATA, CONFIRM_DATA]) {
        errorSpy.mockClear();
        const { messages } = await tap(data, {
          line_entry_status: () => {
            throw new Error("db is down");
          },
          line_delete_entry: () => {
            throw new Error("db is down");
          },
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ type: "text", text: ZH_HANT.genericError });
        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).toContain("db is down");
        expect(logged).not.toContain(LINE_USER_ID);
        expect(logged).not.toContain(KEY);
        expect(logged).not.toContain(data);
      }
    });

    test("a postback that throws does not stop the events after it in the same delivery", async () => {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_entry_status: () => {
          throw new Error("boom");
        },
      });
      const line = fakeLineClient();

      await send(dateDeps(client, line.client), [
        postbackEvent({ data: ASK_DATA, replyToken: "rt-a" }),
        messageEvent({ text: "早餐 60", replyToken: "rt-b" }),
      ]);

      expect(line.calls.reply.map((call) => call.replyToken)).toEqual(["rt-a", "rt-b"]);
      expect(client.rpcCall("line_record_entry")).toBeDefined();
    });
  });

  describe("the whole round trip", () => {
    // [MV]: the button, the question and the answer must carry one key from the record to the delete.
    test("record -> tap 刪除 on the card -> tap 確定刪除 -> the delete RPC gets the key the record was written under", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();
      const d = dateDeps(client, line.client);

      await send(d, [messageEvent({ text: "早餐 60", webhookEventId: "01J0000000000000000000000R" })]);
      const askData = postbacksOf(line.calls.reply[0].messages[0])[0].data;

      await send(d, [postbackEvent({ data: askData, webhookEventId: "01J0000000000000000000000S" })]);
      const confirmData = (line.calls.reply[1].messages[0].quickReply?.items[0].action as { data: string }).data;

      await send(d, [postbackEvent({ data: confirmData, webhookEventId: "01J0000000000000000000000T" })]);

      expect(client.rpcCall("line_record_entry")?.args.p_event_id).toBe("01J0000000000000000000000R");
      expect(client.rpcCall("line_entry_status")?.args.p_entry_key).toBe("01J0000000000000000000000R");
      expect(client.rpcCall("line_delete_entry")?.args).toEqual({
        p_line_user_id: LINE_USER_ID,
        p_entry_key: "01J0000000000000000000000R",
        p_event_id: "01J0000000000000000000000T",
      });
      expect(plainTextOf(line.calls.reply[2].messages[0])).toBe("已刪除：早餐 $60");
    });
  });
});

describe("handleLineWebhook - the mood card after a record", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const dateDeps = (client: FakePostgrest, line: LineClient): LineWebhookDeps => ({ ...deps(client, line), now: () => 1790000000000 });
  const labels = (message: LineMessage | undefined) => (message?.quickReply?.items ?? []).map((item) => item.action.label);
  const textsOf = (message: LineMessage): string[] => {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") found.push(record.text);
        Object.values(record).forEach(walk);
      }
    };
    if (message.type === "flex") walk(message.contents);
    return found;
  };

  const ZH_MOOD = LINE_MOOD_TEXT["zh-Hant"];
  const EN_MOOD = LINE_MOOD_TEXT.en;
  /** 2026-09-21 07:00 in Taiwan (2026-09-20 23:00 UTC). */
  const SEVEN_AM = Date.parse("2026-09-20T23:00:00Z");
  /** 2026-09-22 01:30 in Taiwan, still 2026-09-21 in UTC. */
  const AFTER_MIDNIGHT = Date.parse("2026-09-21T17:30:00Z");

  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
  const logged = () => [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(" ")).join("\n");

  async function record(
    text: string,
    options: { timestamp?: number; webhookEventId?: string; overrides?: Partial<Record<string, RpcHandler>>; context?: unknown } = {},
  ) {
    const { client, state } = createLineFakeClient({
      line_context: () => options.context ?? LINKED_CONTEXT,
      ...options.overrides,
    });
    const line = fakeLineClient();
    await send(dateDeps(client, line.client), [
      messageEvent({ text, timestamp: options.timestamp, webhookEventId: options.webhookEventId }),
    ]);
    const messages = line.calls.reply.at(-1)?.messages ?? [];
    return { client, state, line, messages, mood: messages[1] };
  }

  test("a record is answered with two messages - the record card, then the mood card with the streak - and the shortcuts only on the second", async () => {
    const { messages, mood } = await record("早餐 60");

    expect(messages.map((m) => m.type)).toEqual(["flex", "flex"]);
    expect(plainTextOf(messages[0])).toBe("已記下支出：早餐 $60（餐飲）\n本月支出 $60");
    expect(labels(messages[0])).toEqual([]);
    expect(labels(mood)).toEqual(["復原", "本月", "明細", "分析"]);
    expect(plainTextOf(mood).split("\n")[1]).toBe("連續記帳 3 天");
    expect(textsOf(mood)).toContain("連續記帳 3 天");
    expect(textsOf(mood)).toContain("本月記帳 12 天 · 今天第 1 筆");
  });

  test("line_streak is asked AFTER the entry was written, for this user and the Taiwan date of the entry", async () => {
    const { client } = await record("早餐 60", { timestamp: AFTER_MIDNIGHT });

    const order = client.calls.filter((c) => c.op === "rpc").map((c) => (c as { fn: string }).fn);
    expect(order.indexOf("line_streak")).toBeGreaterThan(order.indexOf("line_record_entry"));
    expect(client.rpcCall("line_streak")?.args).toEqual({ p_line_user_id: LINE_USER_ID, p_today: "2026-09-22" });
    expect(client.rpcCall("line_record_entry")?.args.p_expense_date).toBe("2026-09-22");
  });

  describe("the words", () => {
    // [MV]: use the UTC clock for the hour, or drop the keyword rule, and a row goes red.
    test.each<[string, string, number, keyof typeof ZH_MOOD.short]>([
      ["a breakfast word at breakfast time", "早餐 60", SEVEN_AM, "breakfast"],
      ["a coffee at 07:00 is the afternoon-tea mood (the word beats the clock)", "咖啡 60", SEVEN_AM, "afternoon"],
      ["a food with no meal word (category given), in the morning", "麵包 60 餐飲", SEVEN_AM, "breakfast"],
      ["a food with no meal word, at 01:30 Taiwan time (not UTC)", "麵 60 餐飲", AFTER_MIDNIGHT, "lateNight"],
      ["a big purchase (NT$3,000)", "買鞋 3000", SEVEN_AM, "large"],
      ["a bus fare", "捷運 30", SEVEN_AM, "transport"],
    ])("%s", async (_label, text, timestamp, bucket) => {
      const { mood } = await record(text, { timestamp });
      expect(ZH_MOOD.short[bucket]).toContain(plainTextOf(mood).split("\n")[0]);
    });

    test("an income gets the income lines", async () => {
      const { mood } = await record("+52000 薪水");
      expect(ZH_MOOD.short.income).toContain(plainTextOf(mood).split("\n")[0]);
    });

    test("an English-locale user gets the English lines, the English streak, and English weekday letters", async () => {
      const { mood } = await record("breakfast 60", { context: { ...LINKED_CONTEXT, locale: "en" } });
      expect(EN_MOOD.short.breakfast).toContain(plainTextOf(mood).split("\n")[0]);
      expect(textsOf(mood)).toContain("3-day streak");
      expect(textsOf(mood)).toContain("12 days logged this month · entry 1 today");
    });

    test("a total of one entry is the first-ever milestone", async () => {
      const { mood } = await record("早餐 60", {
        overrides: { line_streak: () => ({ ok: true, stats: { ...STREAK_STATS, total_entries: 1, streak_days: 1, month_days: 5 } }) },
      });
      expect(textsOf(mood)).toContain(ZH_MOOD.milestones.firstEver);
    });

    test("a 7-day streak is the one-week milestone", async () => {
      const { mood } = await record("早餐 60", {
        overrides: { line_streak: () => ({ ok: true, stats: { ...STREAK_STATS, streak_days: 7 } }) },
      });
      expect(textsOf(mood)).toContain(ZH_MOOD.milestones.streak7);
    });
  });

  describe("a redelivery", () => {
    // [MV]: a variant chosen with Math.random / Date.now, or a seed that is not the event key, and the two differ.
    test("the same event delivered twice gets a byte-identical mood card", async () => {
      const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();
      const d = dateDeps(client, line.client);
      const event = messageEvent({ text: "麵 60", webhookEventId: "01J0000000000000000000000M", timestamp: SEVEN_AM });

      await send(d, [event]);
      await send(d, [{ ...event, deliveryContext: { isRedelivery: true } }]);

      expect(line.calls.reply).toHaveLength(2);
      expect(JSON.stringify(line.calls.reply[1].messages[1])).toBe(JSON.stringify(line.calls.reply[0].messages[1]));
      expect(JSON.stringify(line.calls.reply[1].messages)).toBe(JSON.stringify(line.calls.reply[0].messages));
    });

    test("the words stay the same when the streak numbers have moved on, and the numbers are read again", async () => {
      let entriesToday = 1;
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_streak: () => ({ ok: true, stats: { ...STREAK_STATS, today_entries: entriesToday } }),
      });
      const line = fakeLineClient();
      const d = dateDeps(client, line.client);
      const event = messageEvent({ text: "麵 60", webhookEventId: "01J0000000000000000000000M" });

      await send(d, [event]);
      entriesToday = 4;
      await send(d, [event]);

      const [first, second] = line.calls.reply.map((call) => textsOf(call.messages[1]));
      expect(first).toContain("本月記帳 12 天 · 今天第 1 筆");
      expect(second).toContain("本月記帳 12 天 · 今天第 4 筆");
      expect(second.slice(0, 3)).toEqual(first.slice(0, 3));
      expect(client.calls.filter((c) => c.op === "rpc" && c.fn === "line_streak")).toHaveLength(2);
    });

    test("only one entry is written, however often it is delivered, and each delivery is still answered with two messages", async () => {
      const { client, state } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
      const line = fakeLineClient();
      const d = dateDeps(client, line.client);
      const event = messageEvent({ text: "早餐 60", webhookEventId: "01J0000000000000000000000M" });

      await send(d, [event]);
      await send(d, [event]);
      await send(d, [event]);

      expect(state.recordedEntries.size).toBe(1);
      expect(client.calls.filter((c) => c.op === "rpc" && c.fn === "line_record_entry")).toHaveLength(3);
      expect(line.calls.reply.map((call) => call.messages.length)).toEqual([2, 2, 2]);
    });
  });

  describe("when the streak cannot be had", () => {
    /** A message that carries a LINE user id, to prove the log redacts it. */
    const boom = () => {
      throw new Error(`rpc line_streak failed for ${LINE_USER_ID}`);
    };

    // [MV]: let the failure propagate and the saved entry is answered with genericError.
    test.each<[string, RpcHandler]>([
      ["the RPC throws", boom],
      ["the RPC says it is not ok", () => ({ ok: false, reason: "no_ledger" })],
      ["the RPC returns nothing", () => null],
      ["the stats are not an object", () => ({ ok: true, stats: "3 days" })],
      ["the week has six days", () => ({ ok: true, stats: { ...STREAK_STATS, week: [true, true, true, false, false, false] } })],
      ["today_index is out of range", () => ({ ok: true, stats: { ...STREAK_STATS, today_index: 7 } })],
      ["a count is a string", () => ({ ok: true, stats: { ...STREAK_STATS, streak_days: "3" } })],
    ])("%s: the entry is saved, both messages are sent, the mood card has no streak section", async (_label, handler) => {
      const { client, messages, mood } = await record("早餐 60", { overrides: { line_streak: handler } });

      expect(client.calls.filter((c) => c.op === "rpc" && c.fn === "line_record_entry")).toHaveLength(1);
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.type)).toEqual(["flex", "flex"]);
      expect(plainTextOf(messages[0])).toContain("已記下支出：早餐 $60");
      expect(plainTextOf(mood)).not.toBe(ZH_HANT.genericError);
      // Just the two lines: no streak, no month line, no week row.
      expect(textsOf(mood)).toHaveLength(3);
      expect(JSON.stringify(mood)).not.toContain("連續記帳");
      expect(JSON.stringify(mood)).not.toContain("本月記帳");
      expect(plainTextOf(mood).includes("\n")).toBe(false);
      // The shortcuts do not depend on the streak.
      expect(labels(mood)).toEqual(["復原", "本月", "明細", "分析"]);
      // One closed-vocabulary log line.
      expect(logged()).toContain("[line] streak unavailable");
      expect(logged()).not.toContain("早餐");
      expect(logged()).not.toContain(LINE_USER_ID);
    });

    test("logs exactly one streak line per record", async () => {
      await record("早餐 60", { overrides: { line_streak: boom } });
      expect(logged().match(/streak unavailable/g)).toHaveLength(1);
    });

    test("a working streak logs nothing", async () => {
      await record("早餐 60");
      expect(logged()).not.toContain("streak unavailable");
    });
  });

  test("the whole reply, in both locales, passes the reply-level check (the afterEach also checks every reply)", async () => {
    for (const context of [LINKED_CONTEXT, { ...LINKED_CONTEXT, locale: "en" }]) {
      const { messages } = await record(context.locale === "en" ? "breakfast 60" : "早餐 60", { context });
      expect(lineReplyProblems(messages)).toEqual([]);
    }
  });
});
