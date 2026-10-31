// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stashLineIntent, takeStashedLineIntent } from "./lineIntent";
import { useAuthSession } from "./useAuthSession";

/**
 * A link from the LINE bot (?view= / ?entry=) reaches a signed-out visitor at
 * the login wall, and Google's redirect throws the query string away. The
 * intent is stashed just before the redirect so useLineIntent can pick it up
 * on the way back - these pin the stashing half.
 */
function startLogin() {
  const hook = renderHook(() =>
    useAuthSession({ showToast: vi.fn(), onSignedIn: vi.fn(), onSignedOut: vi.fn() }),
  );
  act(() => hook.result.current.startGoogleLogin());
  hook.unmount();
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  // jsdom cannot navigate: assigning location.href logs "not implemented".
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startGoogleLogin and a LINE link", () => {
  test("stashes an entry link before the redirect", () => {
    window.history.replaceState(null, "", "/group/ledger_1?entry=msg%3A1234567890&openExternalBrowser=1");

    startLogin();

    expect(takeStashedLineIntent()).toEqual({ kind: "entry", entryKey: "msg:1234567890" });
  });

  test.each([
    ["records", { kind: "records" }],
    ["analysis", { kind: "analysis" }],
  ])("stashes ?view=%s", (view, intent) => {
    window.history.replaceState(null, "", `/group/ledger_1?view=${view}`);

    startLogin();

    expect(takeStashedLineIntent()).toEqual(intent);
  });

  test("stashes nothing for an ordinary login", () => {
    window.history.replaceState(null, "", "/group/ledger_1");

    startLogin();

    expect(takeStashedLineIntent()).toBeNull();
  });

  test("an old abandoned stash does not survive a login that carries no link", () => {
    stashLineIntent({ kind: "entry", entryKey: "msg:1234567890" });
    window.history.replaceState(null, "", "/");

    startLogin();

    expect(takeStashedLineIntent()).toBeNull();
  });

  test("a link that is not one of ours is not stashed", () => {
    window.history.replaceState(null, "", "/group/ledger_1?view=https%3A%2F%2Fevil.example&entry=short");

    startLogin();

    expect(takeStashedLineIntent()).toBeNull();
  });
});
