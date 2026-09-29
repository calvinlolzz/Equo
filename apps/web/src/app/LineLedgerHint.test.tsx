// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LineLedgerHint } from "./LineLedgerHint";
import { LINE_HINT_DISMISSED_KEY } from "./lineLink";
import { UI_TEXT } from "./uiText";

const t = UI_TEXT.lineLink;
const OA_URL = "https://line.me/R/ti/p/@100ujhjj";

function stubLineFetch(linked: boolean) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/me/line")) {
      return {
        ok: true,
        json: async () => ({ linked, linked_at: linked ? "2026-09-29T00:00:00Z" : null }),
      } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

/** Give a pending fetch + state update the chance to land before asserting an absence. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LineLedgerHint", () => {
  // [MV]
  test("without a configured add-friend URL it neither fetches nor shows", async () => {
    const calls = stubLineFetch(false);
    render(<LineLedgerHint enabled showQr={false} />);
    await settle();

    expect(calls).toHaveLength(0);
    expect(document.querySelector(".line-hint")).toBeNull();
  });

  // [MV]
  test("unlinked with a URL shows the card with a safe add-friend link", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    stubLineFetch(false);
    render(<LineLedgerHint enabled showQr={false} />);

    await screen.findByRole("complementary", { name: t.hintTitle });
    const link = screen.getByRole("link", { name: t.addFriend });
    expect(link.getAttribute("href")).toBe(OA_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  // [MV]
  test("linked shows nothing and remembers it, so the card stays away after an unlink", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    const calls = stubLineFetch(true);
    render(<LineLedgerHint enabled showQr={false} />);

    await waitFor(() => expect(calls.some((url) => url.includes("/me/line"))).toBe(true));
    await waitFor(() => expect(localStorage.getItem(LINE_HINT_DISMISSED_KEY)).toBe("1"));
    expect(document.querySelector(".line-hint")).toBeNull();
  });

  test("while the fetch is still loading there is no card", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(<LineLedgerHint enabled showQr={false} />);
    await settle();

    expect(document.querySelector(".line-hint")).toBeNull();
  });

  test("a failed fetch shows no card", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    render(<LineLedgerHint enabled showQr={false} />);
    await settle();

    expect(document.querySelector(".line-hint")).toBeNull();
  });

  // [MV]
  test("the close button hides the card for good: a fresh mount neither shows nor fetches", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    const calls = stubLineFetch(false);
    render(<LineLedgerHint enabled showQr={false} />);
    await screen.findByRole("complementary", { name: t.hintTitle });

    fireEvent.click(screen.getByRole("button", { name: t.hintDismiss }));
    expect(document.querySelector(".line-hint")).toBeNull();
    expect(localStorage.getItem(LINE_HINT_DISMISSED_KEY)).toBe("1");

    cleanup();
    calls.length = 0;
    render(<LineLedgerHint enabled showQr={false} />);
    await settle();

    expect(document.querySelector(".line-hint")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("unreachable storage still shows the card and the close button still hides it", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    stubLineFetch(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<LineLedgerHint enabled showQr={false} />);

    await screen.findByRole("complementary", { name: t.hintTitle });
    fireEvent.click(screen.getByRole("button", { name: t.hintDismiss }));
    expect(document.querySelector(".line-hint")).toBeNull();
  });

  test("enabled=false does not fetch", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    const calls = stubLineFetch(false);
    render(<LineLedgerHint enabled={false} showQr={false} />);
    await settle();

    expect(calls).toHaveLength(0);
    expect(document.querySelector(".line-hint")).toBeNull();
  });

  // [MV]
  test("showQr renders the QR image; without it there is none", async () => {
    vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
    stubLineFetch(false);
    const { unmount } = render(<LineLedgerHint enabled showQr />);

    const qr = await screen.findByRole("img", { name: t.hintQrAlt });
    expect(qr.closest(".line-hint-qr-frame")).toBeTruthy();
    unmount();

    render(<LineLedgerHint enabled showQr={false} />);
    await screen.findByRole("complementary", { name: t.hintTitle });
    expect(screen.queryByRole("img", { name: t.hintQrAlt })).toBeNull();
  });
});
