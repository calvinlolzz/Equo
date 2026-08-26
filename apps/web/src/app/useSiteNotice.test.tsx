// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useSiteNotice, type SiteNotice } from "./useSiteNotice";
import { UI_TEXT } from "./uiText";

function notice(overrides: Partial<SiteNotice> = {}): SiteNotice {
  return {
    banner: { message: "", level: "info", ends_at: null, active: false },
    maintenance: { enabled: false, message: "" },
    ...overrides,
  };
}

function fetcher(value: SiteNotice) {
  return vi.fn(async () => ({ notice: value }));
}

beforeEach(() => {
  localStorage.removeItem("equo.clean.noticeDismissed");
});

afterEach(() => {
  // Unmount, or the polling interval keeps firing after the environment is torn
  // down and React renders into a window that no longer exists. There is no
  // vitest setup file wiring auto-cleanup in this project, so it is explicit.
  cleanup();
  vi.useRealTimers();
});

describe("useSiteNotice", () => {
  test("shows an active banner", async () => {
    const { result } = renderHook(() =>
      useSiteNotice(fetcher(notice({ banner: { message: "維護預告", level: "warning", ends_at: null, active: true } }))),
    );

    await waitFor(() => expect(result.current.banner).not.toBeNull());
    expect(result.current.banner).toEqual({ message: "維護預告", level: "warning" });
  });

  test("shows nothing when the server says the banner is not active", async () => {
    // Whether it is live - including whether it has expired - is the server's
    // decision, because every client's clock can be wrong and the server's is
    // the only one there is.
    const { result } = renderHook(() =>
      useSiteNotice(fetcher(notice({ banner: { message: "過期了", level: "info", ends_at: null, active: false } }))),
    );

    await waitFor(() => expect(result.current.banner).toBeNull());
  });

  test("a dismissed banner stays dismissed", async () => {
    const live = notice({ banner: { message: "維護預告", level: "info", ends_at: null, active: true } });
    const { result } = renderHook(() => useSiteNotice(fetcher(live)));

    await waitFor(() => expect(result.current.banner).not.toBeNull());
    act(() => result.current.dismissBanner());

    expect(result.current.banner).toBeNull();
  });

  test("a NEW announcement is shown even after the previous one was dismissed", async () => {
    // The bug this design avoids: keying dismissal on a flag would hide every
    // future announcement because somebody closed an old one - so the important
    // message is the one nobody ever sees.
    localStorage.setItem("equo.clean.noticeDismissed", "上一則公告");

    const { result } = renderHook(() =>
      useSiteNotice(fetcher(notice({ banner: { message: "新的公告", level: "info", ends_at: null, active: true } }))),
    );

    await waitFor(() => expect(result.current.banner).not.toBeNull());
    expect(result.current.banner?.message).toBe("新的公告");
  });

  test("re-posting the same text stays dismissed", async () => {
    localStorage.setItem("equo.clean.noticeDismissed", "同一則");

    const { result } = renderHook(() =>
      useSiteNotice(fetcher(notice({ banner: { message: "同一則", level: "info", ends_at: null, active: true } }))),
    );

    // Give the fetch a chance to land before concluding it stayed hidden.
    await waitFor(() => expect(result.current.maintenance).toBeNull());
    expect(result.current.banner).toBeNull();
  });

  test("maintenance is reported and is not dismissible", async () => {
    const { result } = renderHook(() =>
      useSiteNotice(fetcher(notice({ maintenance: { enabled: true, message: "資料庫升級中" } }))),
    );

    await waitFor(() => expect(result.current.maintenance).not.toBeNull());
    expect(result.current.maintenance).toEqual({ message: "資料庫升級中" });

    // dismissBanner is the only dismissal there is, and it does not touch this.
    act(() => result.current.dismissBanner());
    expect(result.current.maintenance).not.toBeNull();
  });

  test("maintenance with no message falls back to something that explains itself", async () => {
    const { result } = renderHook(() =>
      useSiteNotice(fetcher(notice({ maintenance: { enabled: true, message: "" } }))),
    );

    await waitFor(() => expect(result.current.maintenance).not.toBeNull());
    expect(result.current.maintenance?.message).toBe(UI_TEXT.notice.maintenanceFallback);
  });

  test("a failed fetch shows nothing rather than an error", async () => {
    // This is an extra on top of the app. Failing to load an announcement
    // nobody posted must not put an error in front of anybody.
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });

    const { result } = renderHook(() => useSiteNotice(failing));

    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(result.current.banner).toBeNull();
    expect(result.current.maintenance).toBeNull();
  });

  test("does not fetch at all without a fetcher", () => {
    const { result } = renderHook(() => useSiteNotice(null));
    expect(result.current.banner).toBeNull();
    expect(result.current.maintenance).toBeNull();
  });

  test("re-checks on an interval, so a window that starts mid-session is noticed", async () => {
    // A short real interval rather than fake timers: the hook resolves a promise
    // inside the tick, and driving that with fake timers needs the microtask
    // queue flushed by hand for no gain over waiting 30ms.
    const fetchNotice = fetcher(notice());

    renderHook(() => useSiteNotice(fetchNotice, 30));

    await waitFor(() => expect(fetchNotice.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2_000,
    });
  });
});
