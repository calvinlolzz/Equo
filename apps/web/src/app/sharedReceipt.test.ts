// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import {
  clearShareParam,
  hasSharedReceipt,
  SHARE_CACHE_KEY,
  SHARE_CACHE_NAME,
  takeSharedReceiptFile,
} from "./sharedReceipt";

/**
 * A stored entry, response-shaped.
 *
 * Deliberately NOT a real `Response`: jsdom's implementation has no Blob body
 * support and stringifies one to "[object Blob]", which would make every
 * assertion below about the harness rather than about this module.
 */
function parked(blob: Blob, contentType: string | null = blob.type): Response {
  return {
    blob: async () => blob,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
  } as unknown as Response;
}

/**
 * A cache stand-in with just enough of the API surface, plus a record of what
 * was opened and deleted so the one-shot behaviour can be asserted rather than
 * assumed.
 */
function fakeCaches(seed: Response | null) {
  const state = { entry: seed, opened: [] as string[], deleted: 0 };
  return {
    state,
    storage: {
      open: async (name: string) => {
        state.opened.push(name);
        return {
          match: async () => state.entry ?? undefined,
          delete: async () => {
            const had = state.entry !== null;
            state.entry = null;
            state.deleted += 1;
            return had;
          },
        } as unknown as Cache;
      },
    },
  };
}

describe("hasSharedReceipt", () => {
  test("recognises the marker the worker redirects to", () => {
    expect(hasSharedReceipt("?share=receipt")).toBe(true);
    expect(hasSharedReceipt("?invite=abc&share=receipt")).toBe(true);
  });

  test("an ordinary launch, or some other share value, is not a handover", () => {
    expect(hasSharedReceipt("")).toBe(false);
    expect(hasSharedReceipt("?shortcut=add-expense")).toBe(false);
    expect(hasSharedReceipt("?share=")).toBe(false);
    expect(hasSharedReceipt("?share=something-else")).toBe(false);
  });
});

describe("clearShareParam", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("removes only share=, leaving the rest of the URL alone", () => {
    window.history.replaceState(null, "", "/group/g1?invite=abc&share=receipt#top");

    clearShareParam();

    expect(window.location.search).toBe("?invite=abc");
    expect(window.location.pathname).toBe("/group/g1");
    expect(window.location.hash).toBe("#top");
  });

  test("is a no-op when there is nothing to strip", () => {
    window.history.replaceState(null, "", "/group/g1?invite=abc");

    clearShareParam();

    expect(window.location.search).toBe("?invite=abc");
  });
});

describe("takeSharedReceiptFile", () => {
  test("returns the parked photo as a File, carrying its content type", async () => {
    const { storage } = fakeCaches(parked(new Blob(["jpeg-bytes"], { type: "image/jpeg" })));

    const file = await takeSharedReceiptFile(storage);

    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe("image/jpeg");
    expect(await file?.text()).toBe("jpeg-bytes");
  });

  test("opens the share cache by the name the worker writes to", async () => {
    const { state, storage } = fakeCaches(parked(new Blob(["x"], { type: "image/png" })));

    await takeSharedReceiptFile(storage);

    expect(state.opened).toEqual([SHARE_CACHE_NAME]);
    expect(SHARE_CACHE_KEY).toBe("/__shared-receipt");
  });

  test("the handover is one-shot: a second launch gets nothing", async () => {
    const { state, storage } = fakeCaches(parked(new Blob(["x"], { type: "image/jpeg" })));

    expect(await takeSharedReceiptFile(storage)).not.toBeNull();
    expect(await takeSharedReceiptFile(storage)).toBeNull();
    expect(state.deleted).toBe(2);
  });

  test("an empty entry is dropped, and still cleared out", async () => {
    const { state, storage } = fakeCaches(parked(new Blob([], { type: "image/jpeg" })));

    expect(await takeSharedReceiptFile(storage)).toBeNull();
    expect(state.deleted).toBe(1);
  });

  test("nothing parked, and no cache API at all, both read as no share", async () => {
    const { storage } = fakeCaches(null);

    expect(await takeSharedReceiptFile(storage)).toBeNull();
    expect(await takeSharedReceiptFile(null)).toBeNull();
  });

  test("an unreadable cache is a normal launch, not a thrown error", async () => {
    const storage = {
      open: async () => {
        throw new Error("storage blocked");
      },
    };

    await expect(takeSharedReceiptFile(storage)).resolves.toBeNull();
  });
});
