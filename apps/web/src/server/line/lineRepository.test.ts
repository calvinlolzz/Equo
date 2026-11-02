import { describe, expect, test, vi } from "vitest";
import type { PostgrestClient } from "../db/postgrestClient.js";
import { deleteLineEntry, lineEntryStatus, lineStreak, liffLinkIsLive, lineLiffIdentity, resolveLineEntryForUser } from "./lineRepository.js";

/**
 * The wrappers are thin on purpose; what is worth pinning is the RPC name and
 * the argument names, because PostgREST resolves a function by exactly those
 * (a renamed or missing key is a 404 at runtime that no type checker sees).
 */
function clientReturning(value: unknown) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => value);
  return { client: { rpc } as unknown as PostgrestClient, rpc };
}

const SNAPSHOT = {
  id: "4e0a1b6e-0000-4000-8000-000000000001",
  title: "早餐",
  amount_minor: 6000,
  currency: "TWD",
  kind: "expense",
  category: "food",
  expense_date: "2026-11-01",
};

describe("lineEntryStatus", () => {
  test("calls line_entry_status with the LINE user id and the entry key, nothing else", async () => {
    const { client, rpc } = clientReturning({ ok: true, status: "live", edited: false, expense: SNAPSHOT });

    const result = await lineEntryStatus(client, "U" + "a".repeat(32), "evt-0001-abcdef");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("line_entry_status", {
      p_line_user_id: "U" + "a".repeat(32),
      p_entry_key: "evt-0001-abcdef",
    });
    expect(result).toEqual({ ok: true, status: "live", edited: false, expense: SNAPSHOT });
  });

  test("passes a not-linked answer through untouched", async () => {
    const { client } = clientReturning({ ok: false, reason: "not_linked" });
    await expect(lineEntryStatus(client, "U" + "b".repeat(32), "evt-0001-abcdef")).resolves.toEqual({
      ok: false,
      reason: "not_linked",
    });
  });
});

describe("deleteLineEntry", () => {
  test("calls line_delete_entry with the card's entry key AND this postback's event key, under their own argument names", async () => {
    const { client, rpc } = clientReturning({ ok: true, replay: false, edited: true, expense: SNAPSHOT });

    const result = await deleteLineEntry(client, {
      lineUserId: "U" + "c".repeat(32),
      entryKey: "card-key-0001",
      eventId: "delete-event-0001",
    });

    expect(rpc).toHaveBeenCalledWith("line_delete_entry", {
      p_line_user_id: "U" + "c".repeat(32),
      p_entry_key: "card-key-0001",
      p_event_id: "delete-event-0001",
    });
    expect(result).toEqual({ ok: true, replay: false, edited: true, expense: SNAPSHOT });
  });

  test("lets an RPC failure (LINE_INVALID_ENTRY) reach the caller instead of swallowing it", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>): Promise<unknown> => {
      throw new Error("LINE_INVALID_ENTRY");
    });
    await expect(
      deleteLineEntry({ rpc } as unknown as PostgrestClient, { lineUserId: "U", entryKey: "x", eventId: "y" }),
    ).rejects.toThrow("LINE_INVALID_ENTRY");
  });
});

describe("lineStreak", () => {
  test("calls line_streak with the LINE user id and the Taiwan date, and hands back the stats unvalidated", async () => {
    const stats = { streak_days: 3, week: [true, true, true, false, false, false, false] };
    const { client, rpc } = clientReturning({ ok: true, stats });

    const result = await lineStreak(client, "U" + "d".repeat(32), "2026-11-01");

    expect(rpc).toHaveBeenCalledWith("line_streak", { p_line_user_id: "U" + "d".repeat(32), p_today: "2026-11-01" });
    expect(result).toEqual({ ok: true, stats });
  });
});

describe("resolveLineEntryForUser", () => {
  test("calls line_entry_resolve with the session user id and the key - there is no argument for a group", async () => {
    const live = {
      status: "live",
      group_id: "9f0c2f4e-0000-4000-8000-000000000002",
      expense_id: SNAPSHOT.id,
      expense_date: "2026-11-01",
      edited: true,
    };
    const { client, rpc } = clientReturning(live);

    const result = await resolveLineEntryForUser(client, "1d2e3f40-0000-4000-8000-000000000003", "card-key-0001");

    expect(rpc).toHaveBeenCalledWith("line_entry_resolve", {
      p_user: "1d2e3f40-0000-4000-8000-000000000003",
      p_entry_key: "card-key-0001",
    });
    expect(Object.keys(rpc.mock.calls[0]?.[1] as object).sort()).toEqual(["p_entry_key", "p_user"]);
    expect(result).toEqual(live);
  });
});

describe("liffLinkIsLive", () => {
  const claims = { auth_user_id: "user_alice", ledger_id: "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10", line_sub_hash: "f".repeat(64) };

  function clientAnswering(answer: unknown) {
    const rpc = vi.fn(async () => answer);
    return { client: { rpc } as unknown as PostgrestClient, rpc };
  }

  test("asks line_liff_link_live with the user, ledger and hash from the token - nothing else", async () => {
    const { client, rpc } = clientAnswering(true);

    expect(await liffLinkIsLive(client, claims)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("line_liff_link_live", {
      p_user: "user_alice",
      p_ledger: claims.ledger_id,
      p_line_sub_hash: claims.line_sub_hash,
    });
  });

  // [MV]: `return Boolean(live)` would treat "false" and 1 as alive.
  test.each([false, null, undefined, "true", 1, {}, []])("only a literal true is alive (database said %j)", async (answer) => {
    expect(await liffLinkIsLive(clientAnswering(answer).client, claims)).toBe(false);
  });

  test("lets a database failure propagate, so the caller can fail closed", async () => {
    const client = { rpc: vi.fn(async () => { throw new Error("down"); }) } as unknown as PostgrestClient;

    await expect(liffLinkIsLive(client, claims)).rejects.toThrow("down");
  });
});

describe("lineLiffIdentity", () => {
  test("calls line_liff_identity with the LINE user id and nothing else, passing the answer through", async () => {
    const answer = { ok: true, user: { id: "user_alice" }, ledger_id: "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10", locale: "zh-Hant" };
    const { client, rpc } = clientReturning(answer);

    const result = await lineLiffIdentity(client, "U" + "a".repeat(32));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("line_liff_identity", { p_line_user_id: "U" + "a".repeat(32) });
    expect(result).toEqual(answer);
  });
});
