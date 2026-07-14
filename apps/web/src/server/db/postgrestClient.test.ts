import { describe, expect, test } from "vitest";
import { beforeKeyset, columns, createPostgrestClient, eq, inList, isNull, limit, order, query } from "./postgrestClient.js";

function recordingClient(json: unknown = [{ id: "row_1" }], ok = true, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createPostgrestClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok,
        status,
        async json() {
          return json;
        },
      } as Response;
    },
  });

  return { client, calls };
}

describe("createPostgrestClient", () => {
  test("reads with the service-role headers", async () => {
    const { client, calls } = recordingClient([{ id: "group_1" }]);

    await expect(
      client.select("groups", query(columns("id,name"), eq("id", "group_1"), limit(1))),
    ).resolves.toEqual([{ id: "group_1" }]);

    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/groups?select=id,name&id=eq.group_1&limit=1");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toMatchObject({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
    });
  });

  test("inserts asking for the created row back", async () => {
    const { client, calls } = recordingClient([{ id: "group_1", name: "Tokyo" }]);

    await client.insert("groups", { name: "Tokyo", currency: "TWD" }, { query: columns("id,name") });

    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/groups?select=id,name");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ Prefer: "return=representation" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: "Tokyo", currency: "TWD" });
  });

  test("carries an upsert's conflict policy through on the Prefer header", async () => {
    const { client, calls } = recordingClient([{ id: "user_1" }]);

    await client.insert(
      "users",
      { id: "user_1" },
      { query: "on_conflict=google_sub", prefer: "resolution=merge-duplicates" },
    );

    expect(calls[0].init.headers).toMatchObject({
      Prefer: "resolution=merge-duplicates,return=representation",
    });
  });

  test("updates with the filter in the query and the columns in the body", async () => {
    const { client, calls } = recordingClient([{ id: "group_1" }]);

    await client.update("groups", query(eq("id", "group_1"), isNull("deleted_at")), {
      archived_at: "2026-07-14T00:00:00.000Z",
    });

    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/groups?id=eq.group_1&deleted_at=is.null");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ archived_at: "2026-07-14T00:00:00.000Z" });
  });

  test("calls an RPC at the rpc path and returns its jsonb value, not an array of rows", async () => {
    const { client, calls } = recordingClient({ group: { id: "group_1" }, expenses: [] });

    await expect(client.rpc("get_group_detail", { p_group_id: "group_1" })).resolves.toEqual({
      group: { id: "group_1" },
      expenses: [],
    });

    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/rpc/get_group_detail");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_group_id: "group_1" });
  });

  test("re-throws the Postgres error message so a raised sentinel survives the trip", async () => {
    // The write RPCs report business failures by raising NOT_A_GROUP_MEMBER /
    // INVITE_EXPIRED / INVALID_MEMBER:<id>. If this collapsed the body into
    // "request failed: 400", every one of them would reach the user as a 500.
    const { client } = recordingClient({ message: "NOT_A_GROUP_MEMBER" }, false, 400);

    await expect(client.rpc("create_expense", {})).rejects.toThrow("NOT_A_GROUP_MEMBER");
  });

  test("falls back to the status when the error body carries no message", async () => {
    const { client } = recordingClient("not json at all", false, 503);

    await expect(client.select("groups", "")).rejects.toThrow("Supabase REST request failed: 503");
  });
});

describe("query fragments", () => {
  test("in-lists and null filters compose", () => {
    expect(query(columns("id"), inList("id", ["a", "b"]), isNull("deleted_at"), order("created_at.desc"))).toBe(
      "select=id&id=in.(a,b)&deleted_at=is.null&order=created_at.desc",
    );
  });

  test("empty fragments drop out rather than leaving a dangling &", () => {
    expect(query(columns("id"), false, undefined, limit(5))).toBe("select=id&limit=5");
  });

  test("values are URL-encoded", () => {
    expect(eq("email", "a b@example.com")).toBe("email=eq.a%20b%40example.com");
  });

  test("beforeKeyset expands the row-value comparison PostgREST cannot express", () => {
    // `(expense_date, created_at) < ($1, $2)` - strictly less on the date, OR
    // same date and strictly earlier created_at. Using lte anywhere here would
    // repeat a row on every page boundary.
    expect(beforeKeyset("expense_date", "created_at", "2026-07-01", "2026-07-01T10:00:00.000Z")).toBe(
      "or=(expense_date.lt.2026-07-01,and(expense_date.eq.2026-07-01,created_at.lt.2026-07-01T10%3A00%3A00.000Z))",
    );
  });
});
