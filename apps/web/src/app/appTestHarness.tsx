// Test-only. Not imported by the app.
import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "./App";
import type { GroupDetail, GroupSummary } from "./apiClient";

/**
 * Mounts the real <App />, with only the browser stubbed out.
 *
 * The point is to keep the app's own code - the cloud store, the api client, the
 * hooks, the effects and the order they run in - inside the test. The only thing
 * faked is the boundary: fetch, and the handful of browser APIs jsdom lacks.
 * GlassBackground is not in scope, because main.tsx renders it as a sibling of
 * <App />, not inside it - so no WebGL is needed here.
 */

export const SESSION_KEY = "equo.clean.session";

export type ApiRoute = {
  /** e.g. "GET /groups", "POST /groups/group_1/expenses". */
  route: string;
  status?: number;
  body: unknown;
};

export type FakeApi = {
  /** Every request the app made, in order, as "METHOD /path". */
  calls: string[];
  /** Replace or add a route mid-test (e.g. to make the next refresh fail). */
  set(route: string, body: unknown, status?: number): void;
};

export function stubBrowser(options: { mobile?: boolean } = {}): void {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");

  // jsdom has no layout engine, so matchMedia is stubbed. It stays query-aware:
  // only width breakpoints answer `true` in mobile mode, so an unrelated query
  // (e.g. prefers-color-scheme / prefers-reduced-motion) is never accidentally
  // flipped on. Default (desktop) keeps every query false, exactly as before.
  //
  // Note `mobile: true` matches EVERY max-width query, including the 620px
  // phone breakpoint (useSwipeToDismiss, ExpenseComposerSheet, ...), so it
  // simulates a ≤620px phone - not the 621-960px tablet band.
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: options.mobile ? /max-width/.test(query) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );

  // crypto.randomUUID: every mutation mints a client_request_id with it.
  let uuid = 0;
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => `req_${++uuid}`,
  });
}

/**
 * A fetch that answers from a route table. An unlisted route throws - but the app
 * catches its own refresh failures (refreshGroups/refreshGroupDetail both .catch
 * into a toast), so a stray route surfaces as a 同步失敗 toast, not a failed test
 * run. It is always recorded in `calls` (pushed before the throw), so assert on
 * `calls` when you need to prove a request did or did not happen; do not rely on
 * an unlisted route to fail the test for you.
 */
export function fakeApi(routes: ApiRoute[]): FakeApi {
  const table = new Map<string, { status: number; body: unknown }>();
  for (const { route, status, body } of routes) {
    table.set(route, { status: status ?? 200, body });
  }

  const calls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
      const key = `${method} ${path}`;
      calls.push(key);

      const match = table.get(key);

      if (!match) {
        throw new Error(`No fake route for "${key}". Routes: ${[...table.keys()].join(", ")}`);
      }

      return {
        ok: match.status >= 200 && match.status < 300,
        status: match.status,
        json: async () => match.body,
      } as Response;
    }),
  );

  return {
    calls,
    set(route, body, status = 200) {
      table.set(route, { status, body });
    },
  };
}

export function signIn(user: { id?: string; displayName?: string } = {}): void {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      // No token: the session travels in the HttpOnly cookie (see sessionStore).
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: {
        id: user.id ?? "user_alice",
        email: "alice@example.com",
        displayName: user.displayName ?? "Alice",
      },
    }),
  );
}

export function group(overrides: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id: "group_1",
    name: "東京旅行",
    currency: "TWD",
    owner_member_id: "member_alice",
    cover_image_url: null,
    ...overrides,
  };
}

export function groupDetail(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    group: group(),
    members: [
      {
        id: "member_alice",
        group_id: "group_1",
        user_id: "user_alice",
        display_name: "Alice",
        role: "owner",
        status: "active",
      },
    ],
    expenses: [],
    balances: [{ memberId: "member_alice", balance: { amount_minor: 0, currency: "TWD" } }],
    expense_count: 0,
    spend_total_minor: 0,
    spend_by_day: [],
    spend_by_category: [],
    member_day_shares: [],
    ...overrides,
  };
}

export function renderApp(): RenderResult {
  return render(<App />);
}
