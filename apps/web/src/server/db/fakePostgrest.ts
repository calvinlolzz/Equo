import type { InsertOptions, PostgrestClient } from "./postgrestClient.js";

/**
 * Test double for PostgrestClient.
 *
 * Repositories used to be tested against a fake that answered SQL strings -
 * strings that production never executed, because a translator substring-matched
 * them into PostgREST calls instead. So the tests asserted one thing and
 * production did another, and the two could drift apart indefinitely without
 * anything failing. (They did: invite expiry was in the SQL and not in the
 * translated call; every UPDATE claimed `updated_at = now()` and none of them
 * wrote it.)
 *
 * This fake speaks the same vocabulary the real client does. A repository test
 * asserting `update("groups", ..., { archived_at, updated_at })` is asserting
 * the literal request production sends.
 */
export type RecordedCall =
  | { op: "select"; table: string; query: string }
  | { op: "insert"; table: string; body: unknown; options?: InsertOptions }
  | { op: "update"; table: string; query: string; body: unknown }
  | { op: "rpc"; fn: string; args: Record<string, unknown> };

export type FakePostgrestHandlers = {
  select?: (table: string, query: string) => unknown[];
  insert?: (table: string, body: unknown, options?: InsertOptions) => unknown[];
  update?: (table: string, query: string, body: unknown) => unknown[];
  rpc?: (fn: string, args: Record<string, unknown>) => unknown;
};

export type FakePostgrest = PostgrestClient & {
  calls: RecordedCall[];
  /** Every call made against `table`, in order. */
  on(table: string): RecordedCall[];
  /** The single rpc call to `fn`, or undefined. */
  rpcCall(fn: string): Extract<RecordedCall, { op: "rpc" }> | undefined;
};

export function createFakePostgrest(handlers: FakePostgrestHandlers = {}): FakePostgrest {
  const calls: RecordedCall[] = [];

  return {
    calls,

    on(table) {
      return calls.filter((call) => "table" in call && call.table === table);
    },

    rpcCall(fn) {
      return calls.find(
        (call): call is Extract<RecordedCall, { op: "rpc" }> => call.op === "rpc" && call.fn === fn,
      );
    },

    async select<T>(table: string, query: string) {
      calls.push({ op: "select", table, query });

      if (!handlers.select) {
        throw new Error(`Unexpected select on ${table}?${query}`);
      }

      return handlers.select(table, query) as T[];
    },

    async insert<T>(table: string, body: unknown, options?: InsertOptions) {
      calls.push({ op: "insert", table, body, options });

      if (!handlers.insert) {
        throw new Error(`Unexpected insert into ${table}`);
      }

      return handlers.insert(table, body, options) as T[];
    },

    async update<T>(table: string, query: string, body: unknown) {
      calls.push({ op: "update", table, query, body });

      if (!handlers.update) {
        throw new Error(`Unexpected update on ${table}?${query}`);
      }

      return handlers.update(table, query, body) as T[];
    },

    async rpc<T>(fn: string, args: Record<string, unknown>) {
      calls.push({ op: "rpc", fn, args });

      if (!handlers.rpc) {
        throw new Error(`Unexpected rpc ${fn}`);
      }

      return handlers.rpc(fn, args) as T;
    },
  };
}
