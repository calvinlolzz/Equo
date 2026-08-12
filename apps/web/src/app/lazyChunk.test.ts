import { describe, expect, test } from "vitest";
import { isStaleChunkError, loadChunk, type ChunkRecoveryDeps } from "./lazyChunk";

/** Deps with everything permissive, plus a record of what got called. */
function deps(overrides: Partial<ChunkRecoveryDeps> = {}) {
  const state = { reloads: 0, claims: 0 };
  const value: ChunkRecoveryDeps = {
    isOnline: () => true,
    claimReload: () => {
      state.claims += 1;
      return true;
    },
    reload: () => {
      state.reloads += 1;
    },
    ...overrides,
  };
  return { state, value };
}

/** Resolves to "pending" if the promise hasn't settled by the next few ticks. */
async function settledOrPending<T>(promise: Promise<T>): Promise<T | "pending" | { threw: unknown }> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then((v) => v).catch((error) => ({ threw: error })),
    new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 20)),
  ]);
  return result === pending ? "pending" : (result as T | { threw: unknown });
}

describe("isStaleChunkError", () => {
  test("recognises how each browser words a missing chunk", () => {
    // Safari — the wording in the 2026-08-11 report.
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    // Firefox / Chrome, when the SPA rewrite answered with index.html.
    expect(isStaleChunkError(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: /assets/x.js"))).toBe(true);
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new Error("Unable to preload CSS for /assets/x.css"))).toBe(true);
  });

  test("a plain string reason counts — unhandledrejection does not always carry an Error", () => {
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
  });

  test("an ordinary crash inside a loaded module is NOT one of these", () => {
    // The distinction that matters: reloading on these would throw the user's
    // screen away every time they opened a panel with a real bug in it.
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isStaleChunkError(new Error("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe("loadChunk", () => {
  test("passes the module through when the import works", async () => {
    const { state, value } = deps();

    await expect(loadChunk(async () => ({ default: "panel" }), value)).resolves.toEqual({ default: "panel" });
    expect(state.reloads).toBe(0);
    // Not even asked: the guard is only consulted on the failure path.
    expect(state.claims).toBe(0);
  });

  test("a stale chunk reloads, and never settles so no error frame paints first", async () => {
    const { state, value } = deps();

    const result = await settledOrPending(
      loadChunk(() => Promise.reject(new TypeError("Importing a module script failed.")), value),
    );

    expect(state.reloads).toBe(1);
    expect(result).toBe("pending");
  });

  test("offline does not reload — the import was always going to fail", async () => {
    const { state, value } = deps({ isOnline: () => false });

    await expect(
      loadChunk(() => Promise.reject(new TypeError("Importing a module script failed.")), value),
    ).rejects.toThrow("Importing a module script failed.");
    expect(state.reloads).toBe(0);
  });

  test("a refused claim surfaces the error instead of reloading again", async () => {
    // What a second failure inside the cooldown looks like: reloading is not
    // fixing this, so stop and let the error be seen.
    const { state, value } = deps({ claimReload: () => false });

    await expect(
      loadChunk(() => Promise.reject(new TypeError("Importing a module script failed.")), value),
    ).rejects.toThrow();
    expect(state.reloads).toBe(0);
  });

  test("an ordinary module error propagates untouched", async () => {
    const { state, value } = deps();

    await expect(loadChunk(() => Promise.reject(new Error("boom in render")), value)).rejects.toThrow("boom in render");
    expect(state.reloads).toBe(0);
    expect(state.claims).toBe(0);
  });
});
