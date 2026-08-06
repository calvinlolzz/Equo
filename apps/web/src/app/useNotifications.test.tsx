// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { EquoApiClient, NotificationsPage } from "./apiClient";
import { useNotifications } from "./useNotifications";

function makeItem(id: string, read = false) {
  return {
    id,
    kind: "announcement",
    title: `公告 ${id}`,
    body: "內容",
    link: null,
    created_at: "2026-08-05T00:00:00.000Z",
    read_at: read ? "2026-08-05T01:00:00.000Z" : null,
  };
}

/** Just the two methods the hook uses; the rest of the client is irrelevant here. */
function makeClient(page: NotificationsPage, overrides: Partial<EquoApiClient> = {}) {
  return {
    listNotifications: vi.fn(async () => page),
    markNotificationsRead: vi.fn(async () => ({ marked: page.unread, unread: 0 })),
    deleteNotifications: vi.fn(async () => ({ deleted: 1, unread: 0 })),
    ...overrides,
  } as unknown as EquoApiClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the inbox hook", () => {
  test("reads the inbox once signed in", async () => {
    const client = makeClient({ unread: 2, items: [makeItem("a"), makeItem("b")] });

    const { result } = renderHook(() => useNotifications(client, true));

    await waitFor(() => expect(result.current.unread).toBe(2));
    expect(result.current.items).toHaveLength(2);
  });

  test("signed out, it never asks and reports nothing", async () => {
    const client = makeClient({ unread: 5, items: [makeItem("a")] });

    const { result } = renderHook(() => useNotifications(client, false));

    expect(client.listNotifications).not.toHaveBeenCalled();
    expect(result.current.unread).toBe(0);
  });

  test("signing out clears a badge the previous account left behind", async () => {
    const client = makeClient({ unread: 3, items: [makeItem("a")] });
    const { result, rerender } = renderHook(({ on }) => useNotifications(client, on), {
      initialProps: { on: true },
    });

    await waitFor(() => expect(result.current.unread).toBe(3));

    rerender({ on: false });

    expect(result.current.unread).toBe(0);
    expect(result.current.items).toEqual([]);
  });

  test("marking read clears the badge and stamps the rows without waiting for the server", async () => {
    let resolveWrite = () => {};
    const client = makeClient(
      { unread: 2, items: [makeItem("a"), makeItem("b")] },
      {
        markNotificationsRead: vi.fn(
          () =>
            new Promise<{ marked: number; unread: number }>((resolve) => {
              resolveWrite = () => resolve({ marked: 2, unread: 0 });
            }),
        ),
      } as Partial<EquoApiClient>,
    );

    const { result } = renderHook(() => useNotifications(client, true));
    await waitFor(() => expect(result.current.unread).toBe(2));

    act(() => {
      void result.current.markAllRead();
    });

    // The badge is gone before the request settles - that is the whole point of
    // it being optimistic.
    expect(result.current.unread).toBe(0);
    expect(result.current.items.every((item) => item.read_at !== null)).toBe(true);

    await act(async () => {
      resolveWrite();
    });
    expect(client.markNotificationsRead).toHaveBeenCalledTimes(1);
  });

  test("with nothing unread it does not write at all", async () => {
    const client = makeClient({ unread: 0, items: [makeItem("a", true)] });
    const { result } = renderHook(() => useNotifications(client, true));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.markAllRead();
    });

    expect(client.markNotificationsRead).not.toHaveBeenCalled();
  });

  test("a failed read leaves the last known badge alone rather than erroring", async () => {
    const client = makeClient(
      { unread: 0, items: [] },
      { listNotifications: vi.fn(async () => { throw new Error("offline"); }) } as Partial<EquoApiClient>,
    );

    const { result } = renderHook(() => useNotifications(client, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unread).toBe(0);
    expect(result.current.items).toEqual([]);
  });
});

describe("tidying the inbox", () => {
  test("deleting one row drops it and decrements the badge before the server answers", async () => {
    let resolveWrite = () => {};
    const client = makeClient(
      { unread: 2, items: [makeItem("a"), makeItem("b")] },
      {
        deleteNotifications: vi.fn(
          () =>
            new Promise<{ deleted: number; unread: number }>((resolve) => {
              resolveWrite = () => resolve({ deleted: 1, unread: 1 });
            }),
        ),
      } as Partial<EquoApiClient>,
    );

    const { result } = renderHook(() => useNotifications(client, true));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      void result.current.remove("a");
    });

    expect(result.current.items.map((item) => item.id)).toEqual(["b"]);
    expect(result.current.unread).toBe(1);

    await act(async () => {
      resolveWrite();
    });
    expect(client.deleteNotifications).toHaveBeenCalledWith(["a"]);
  });

  test("deleting an already-read row leaves the badge alone", async () => {
    const client = makeClient({ unread: 1, items: [makeItem("a", true), makeItem("b")] });
    const { result } = renderHook(() => useNotifications(client, true));
    await waitFor(() => expect(result.current.unread).toBe(1));

    await act(async () => {
      await result.current.remove("a");
    });

    // "a" was read, so it was never part of the count.
    expect(result.current.unread).toBe(1);
  });

  test("clearing empties the list and calls the server with no ids", async () => {
    const client = makeClient({ unread: 2, items: [makeItem("a"), makeItem("b")] });
    const { result } = renderHook(() => useNotifications(client, true));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.clearAll();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.unread).toBe(0);
    expect(client.deleteNotifications).toHaveBeenCalledWith();
  });

  test("a failed delete re-reads rather than leaving the row silently gone", async () => {
    const client = makeClient(
      { unread: 1, items: [makeItem("a")] },
      { deleteNotifications: vi.fn(async () => { throw new Error("offline"); }) } as Partial<EquoApiClient>,
    );

    const { result } = renderHook(() => useNotifications(client, true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.remove("a");
    });

    // The refresh puts it back, because it was never actually deleted.
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });
});
