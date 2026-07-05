import { describe, expect, test } from "vitest";
import { createApiClient } from "./apiClient";

describe("createApiClient", () => {
  test("uses same-origin credentials and omits Authorization when no token is present", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return { group: { id: "group_1", name: "Cookie Trip", currency: "TWD", owner_member_id: "member_1" } };
          },
        } as Response;
      },
    });

    await client.createGroup({
      client_request_id: "group_req",
      name: "Cookie Trip",
      currency: "TWD",
    });

    expect(calls[0].init.credentials).toBe("same-origin");
    expect(calls[0].init.headers).not.toMatchObject({ Authorization: expect.any(String) });
  });

  test("loads groups from the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "session-token",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              groups: [{ id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" }],
            };
          },
        } as Response;
      },
    });

    await expect(client.listGroups()).resolves.toMatchObject({
      groups: [{ id: "group_1", name: "Tokyo Trip" }],
    });

    expect(calls[0].url).toBe("/api/v1/groups");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer session-token" });
  });

  test("loads a group detail from the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "session-token",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" },
              members: [],
              expenses: [],
              balances: [],
            };
          },
        } as Response;
      },
    });

    await expect(client.getGroupDetail("group_1")).resolves.toMatchObject({
      group: { id: "group_1" },
    });

    expect(calls[0].url).toBe("/api/v1/groups/group_1");
    expect(calls[0].init.method).toBe("GET");
  });

  test("accepts an invite through the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "session-token",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" },
              member: {
                id: "member_2",
                group_id: "group_1",
                user_id: "user_2",
                display_name: "Guest",
                role: "member",
                status: "active",
              },
              claimed: false,
            };
          },
        } as Response;
      },
    });

    await expect(
      client.acceptInvite("EQO123", {
        client_request_id: "accept_req",
        display_name: "Guest",
      }),
    ).resolves.toMatchObject({
      group: { id: "group_1" },
      member: { display_name: "Guest" },
    });

    expect(calls[0].url).toBe("/api/v1/invites/EQO123/accept");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ client_request_id: "accept_req", display_name: "Guest" }));
  });

  test("exchanges a Google ID token for an Equo session", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              session: {
                token: "equo-session",
                expires_at: "2026-07-07T00:00:00.000Z",
                user: {
                  id: "user_1",
                  email: "alice@example.com",
                  display_name: "Alice",
                },
              },
            };
          },
        } as Response;
      },
    });

    await expect(client.exchangeGoogleToken("google-id-token")).resolves.toMatchObject({
      session: { token: "equo-session" },
    });

    expect(calls[0].url).toBe("/api/v1/auth/google");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ id_token: "google-id-token" }));
  });
});
