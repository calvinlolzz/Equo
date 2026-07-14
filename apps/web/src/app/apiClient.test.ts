import { describe, expect, test } from "vitest";
import { createApiClient } from "./apiClient";

describe("createApiClient", () => {
  test("sends same-origin credentials and never an Authorization header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
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
    // The session rides in the equo_session HttpOnly cookie, which the browser
    // attaches via credentials: "same-origin". There is no token in JS to put in
    // a header - which is the point: script cannot read the credential, so an
    // XSS on this page cannot steal it.
    expect(calls[0].init.headers).not.toMatchObject({ Authorization: expect.any(String) });
  });

  test("loads groups from the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
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
    expect(calls[0].init.headers).not.toHaveProperty("Authorization");
    expect(calls[0].init.credentials).toBe("same-origin");
  });

  test("loads a group detail from the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
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

  test("renames a group member through PATCH /groups/:groupId/members/:memberId", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              member: {
                id: "member_2",
                group_id: "group_1",
                user_id: null,
                display_name: "Bobby",
                role: "member",
                status: "active",
              },
            };
          },
        } as Response;
      },
    });

    await expect(
      client.renameGroupMember("group_1", "member_2", { client_request_id: "rename_req", display_name: "Bobby" }),
    ).resolves.toMatchObject({ member: { id: "member_2", display_name: "Bobby" } });

    expect(calls[0].url).toBe("/api/v1/groups/group_1/members/member_2");
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.body).toBe(JSON.stringify({ client_request_id: "rename_req", display_name: "Bobby" }));
  });

  test("removes a group member through DELETE /groups/:groupId/members/:memberId", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              member: {
                id: "member_2",
                group_id: "group_1",
                user_id: null,
                display_name: "Bob",
                role: "member",
                status: "removed",
              },
            };
          },
        } as Response;
      },
    });

    await expect(
      client.removeGroupMember("group_1", "member_2", { client_request_id: "remove_req" }),
    ).resolves.toMatchObject({ member: { id: "member_2", status: "removed" } });

    expect(calls[0].url).toBe("/api/v1/groups/group_1/members/member_2");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].init.body).toBe(JSON.stringify({ client_request_id: "remove_req" }));
  });

  test("surfaces the API error code when member removal is balance-gated", async () => {
    const client = createApiClient({
      fetcher: async () =>
        ({
          ok: false,
          async json() {
            return {
              error: {
                code: "MEMBER_HAS_BALANCE",
                message: "Member still has an unsettled balance and cannot be removed.",
                request_id: "remove_req",
              },
            };
          },
        }) as Response,
    });

    await expect(
      client.removeGroupMember("group_1", "member_2", { client_request_id: "remove_req" }),
    ).rejects.toMatchObject({ code: "MEMBER_HAS_BALANCE" });
  });
});
