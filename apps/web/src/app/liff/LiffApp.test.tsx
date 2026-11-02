// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LiffAppContext } from "../appChrome";
import { UI_TEXT } from "../uiText";
import { LiffApp } from "./LiffApp";
import type { LiffBootDeps } from "./liffBoot";
import type { LiffSdk } from "./liffSdk";

/**
 * The page around the state machine (liffBoot.test.ts pins the machine): which
 * screen each outcome lands on, that the boot happens once, that nothing is
 * persisted, and that a session which cannot be renewed ends on a plain screen
 * rather than the Google login wall. The App itself is stubbed - App.liff.test
 * covers it for real.
 */
let appContext: LiffAppContext | null = null;

vi.mock("../App", () => ({
  App: ({ liff }: { liff: LiffAppContext }) => {
    appContext = liff;
    return (
      <div data-testid="app">
        <button type="button" onClick={() => void liff.reauthenticate()}>
          expire
        </button>
      </div>
    );
  },
}));

const text = UI_TEXT.liff;
const LEDGER = "0d9f4c7e-3b1a-4c55-9e0a-1f2a3b4c5d6e";

function apiError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function fakes(
  options: {
    liffId?: string | null;
    loggedIn?: boolean;
    exchange?: () => Promise<unknown>;
  } = {},
) {
  const sdk = {
    init: vi.fn(async () => {}),
    isLoggedIn: vi.fn(() => options.loggedIn ?? true),
    isInClient: vi.fn(() => true),
    login: vi.fn(),
    logout: vi.fn(),
    getIDToken: vi.fn(() => "id.token.value"),
    closeWindow: vi.fn(),
    openWindow: vi.fn(),
  } satisfies LiffSdk;
  const api = {
    getLiffConfig: vi.fn(async () => ({ liff_id: options.liffId === undefined ? "2011782032-WJwjePnJ" : options.liffId })),
    exchangeLineIdToken: vi.fn(
      options.exchange ??
        (async () => ({
          session: {
            token: "equoL1.x.y",
            expires_at: "2099-01-01T00:00:00.000Z",
            user: { id: "u1", google_sub: "g", email: "a@example.com", display_name: "Alice", avatar_url: null },
            ledger_id: LEDGER,
            locale: "zh-Hant",
          },
        })),
    ),
  };
  const setBearer = vi.fn();
  const replaceUrl = vi.fn();
  const overrides: Partial<LiffBootDeps> = {
    sdk: async () => sdk,
    api: api as unknown as LiffBootDeps["api"],
    setBearer,
    replaceUrl,
    navigationType: () => undefined,
  };
  return { sdk, api, setBearer, replaceUrl, overrides };
}

beforeEach(() => {
  appContext = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/liff");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LiffApp: the screens", () => {
  test("shows the loading line first, then the App once signed in", async () => {
    const { overrides } = fakes();
    render(<LiffApp overrides={overrides} />);
    expect(screen.getByText(text.loading)).toBeTruthy();
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(appContext?.ledgerId).toBe(LEDGER);
    expect(appContext?.session.user.displayName).toBe("Alice");
  });

  test("not linked: says so, offers the way back to the chat, and closes the window from there", async () => {
    const { overrides, sdk } = fakes({ exchange: () => Promise.reject(apiError("LINE_NOT_LINKED")) });
    render(<LiffApp overrides={overrides} />);
    expect(await screen.findByText(text.notLinkedTitle)).toBeTruthy();
    expect(screen.getByText(text.notLinkedBody)).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: text.backToChat }));
    await waitFor(() => expect(sdk.closeWindow).toHaveBeenCalledTimes(1));
  });

  test("disabled account", async () => {
    const { overrides } = fakes({ exchange: () => Promise.reject(apiError("ACCOUNT_DISABLED")) });
    render(<LiffApp overrides={overrides} />);
    expect(await screen.findByText(text.disabled)).toBeTruthy();
  });

  test.each([
    ["LIFF switched off", { liffId: null }],
    ["a failed exchange", { exchange: () => Promise.reject(apiError("LINE_UNAVAILABLE")) }],
  ])("%s: says so and links to the browser app in a new tab", async (_name, options) => {
    const { overrides } = fakes(options);
    render(<LiffApp overrides={overrides} />);
    expect(await screen.findByText(text.failed)).toBeTruthy();
    const link = screen.getByRole("link", { name: text.openInBrowser }) as HTMLAnchorElement;
    expect(link.href).toContain("openExternalBrowser=1");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(screen.queryByTestId("app")).toBeNull();
  });

  test("on its way to LINE's sign-in it keeps the loading line", async () => {
    const { overrides, sdk } = fakes({ loggedIn: false });
    render(<LiffApp overrides={overrides} />);
    await waitFor(() => expect(sdk.login).toHaveBeenCalledTimes(1));
    expect(screen.getByText(text.loading)).toBeTruthy();
  });
});

describe("LiffApp: boot and storage", () => {
  test("boots once under StrictMode's double effect", async () => {
    const { overrides, api, sdk } = fakes();
    render(
      <StrictMode>
        <LiffApp overrides={overrides} />
      </StrictMode>,
    );
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(api.getLiffConfig).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(api.exchangeLineIdToken).toHaveBeenCalledTimes(1);
  });

  test("persists no session, even though the App is up", async () => {
    window.localStorage.setItem("equo.clean.session", "NORMAL");
    const { overrides } = fakes();
    render(<LiffApp overrides={overrides} />);
    await screen.findByTestId("app");
    expect(window.localStorage.getItem("equo.clean.session")).toBe("NORMAL");
    expect(window.localStorage.length).toBe(1);
  });

  test("hands the bearer to the api client, and the address bar is replaced with the ledger path", async () => {
    const { overrides, setBearer, replaceUrl } = fakes();
    render(<LiffApp overrides={overrides} />);
    await screen.findByTestId("app");
    expect(setBearer).toHaveBeenCalledWith("equoL1.x.y");
    expect(replaceUrl).toHaveBeenCalledWith(`/group/${LEDGER}`);
  });
});

describe("LiffApp: a session that cannot be renewed", () => {
  test("ends on its own screen - not the Google login wall, not a blank page", async () => {
    const { overrides, api, sdk } = fakes();
    render(<LiffApp overrides={overrides} />);
    await screen.findByTestId("app");

    // The renewal's exchange is refused.
    api.exchangeLineIdToken.mockRejectedValueOnce(apiError("LINE_NOT_LINKED"));
    await act(async () => {
      fireEvent.click(screen.getByText("expire"));
    });

    expect(await screen.findByText(text.sessionEnded)).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();
    expect(screen.queryByText(UI_TEXT.login.googleLogin)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: text.backToChat }));
    await waitFor(() => expect(sdk.closeWindow).toHaveBeenCalled());
  });

  test("a renewal that works leaves the App up", async () => {
    const { overrides, setBearer, api } = fakes();
    render(<LiffApp overrides={overrides} />);
    await screen.findByTestId("app");

    await act(async () => {
      fireEvent.click(screen.getByText("expire"));
    });

    await waitFor(() => expect(api.exchangeLineIdToken).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("app")).toBeTruthy();
    expect(screen.queryByText(text.sessionEnded)).toBeNull();
    // Old bearer dropped first, new one installed.
    expect(setBearer.mock.calls.map((call) => call[0])).toEqual(["equoL1.x.y", null, "equoL1.x.y"]);
  });
});
