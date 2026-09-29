import { describe, expect, test, vi } from "vitest";
import { LineApiError, createLineClient } from "./lineClient.js";

function fakeFetch(status: number, body: unknown = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("createLineClient.reply", () => {
  test("POSTs to the reply endpoint with the bearer token, JSON body and an abort signal", async () => {
    const fetcher = fakeFetch(200);
    const client = createLineClient({ channelAccessToken: "test-token", fetcher });

    await client.reply("rt1", [{ type: "text", text: "hi" }]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/reply");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ replyToken: "rt1", messages: [{ type: "text", text: "hi" }] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("throws LineApiError with only the status on a non-2xx response, never the body", async () => {
    const fetcher = fakeFetch(400, { message: "invalid reply token rt1 with secret stuff" });
    const client = createLineClient({ channelAccessToken: "t", fetcher });

    await expect(client.reply("rt1", [])).rejects.toBeInstanceOf(LineApiError);
    try {
      await client.reply("rt1", []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LineApiError);
      const apiError = error as LineApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.message).not.toContain("rt1");
      expect(apiError.message).not.toContain("secret");
    }
  });
});

describe("createLineClient.issueLinkToken", () => {
  test("POSTs to the per-user linkToken endpoint with the userId URL-encoded", async () => {
    const fetcher = fakeFetch(200, { linkToken: "abc123" });
    const client = createLineClient({ channelAccessToken: "t", fetcher });

    const token = await client.issueLinkToken("U0123456789abcdef0123456789abcdef");

    expect(token).toBe("abc123");
    const [url] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/user/U0123456789abcdef0123456789abcdef/linkToken");
  });

  test("URL-encodes a userId containing special characters", async () => {
    const fetcher = fakeFetch(200, { linkToken: "abc123" });
    const client = createLineClient({ channelAccessToken: "t", fetcher });

    await client.issueLinkToken("U/weird id");

    const [url] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`https://api.line.me/v2/bot/user/${encodeURIComponent("U/weird id")}/linkToken`);
  });
});

describe("createLineClient.leave", () => {
  test("group target posts to the group leave endpoint", async () => {
    const fetcher = fakeFetch(200);
    const client = createLineClient({ channelAccessToken: "t", fetcher });

    await client.leave({ type: "group", groupId: "G1" });

    const [url] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/group/G1/leave");
  });

  test("room target posts to the room leave endpoint", async () => {
    const fetcher = fakeFetch(200);
    const client = createLineClient({ channelAccessToken: "t", fetcher });

    await client.leave({ type: "room", roomId: "R1" });

    const [url] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/room/R1/leave");
  });
});
