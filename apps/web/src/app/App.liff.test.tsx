// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { liffAllows } from "../server/http/liffScope";
import { App } from "./App";
import type { LiffAppContext } from "./appChrome";
import { resetApiBearerForTests, setApiBearerToken, type ExpenseSummary } from "./apiClient";
import { group, groupDetail, stubBrowser, SESSION_KEY } from "./appTestHarness";
import type { LineIntent } from "./lineIntent";
import { UI_TEXT } from "./uiText";

/**
 * The real <App /> in its LIFF chrome, end to end: what it asks the server
 * for, what it keeps in the browser, what it shows, and what it does when the
 * session ends. Every test is also checked against the server's own allowlist
 * (liffAllows) - a request the gate would refuse is a client bug that only
 * shows up inside LINE, so it fails here instead.
 */
configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

const app = UI_TEXT.app;
const LEDGER = "0d9f4c7e-3b1a-4c55-9e0a-1f2a3b4c5d6e";
const BEARER = "equoL1.test.signature";
const KEY = "msg:1234567890";
const ENTRY_ROUTE = `GET /me/line/entries/${encodeURIComponent(KEY)}`;

const SESSION = {
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
};

const CACHE_KEY = "equo.clean.cloud_cache";
const NORMAL_CACHE = JSON.stringify({ userId: "user_normal", groups: [], groupDetails: {} });

const NORMAL_SESSION = JSON.stringify({
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: { id: "user_normal", email: "normal@example.com", displayName: "Normal" },
});

type Seen = {
  method: string;
  path: string;
  key: string;
  authorization: string | undefined;
  credentials: RequestCredentials | undefined;
  body: BodyInit | null | undefined;
};

type Route = { status?: number; body: unknown };

let seen: Seen[] = [];
let routes = new Map<string, Route>();

function route(key: string, body: unknown, status = 200) {
  routes.set(key, { status, body });
}

/** Answers from `routes`; an unlisted route is a 404 the app has to cope with (and is still recorded). */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(url).split("?")[0];
      const key = `${method} ${path.replace(/^\/api\/v1/, "")}`;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        method,
        path,
        key,
        authorization: headers.Authorization,
        credentials: init?.credentials,
        body: init?.body,
      });
      const match = routes.get(key);
      const status = match?.status ?? 404;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => match?.body ?? { error: { code: "NOT_FOUND", message: "no route" } },
      } as Response;
    }),
  );
}

function ledger() {
  return group({ id: LEDGER, name: "個人帳本", kind: "personal", owner_member_id: "member_alice" });
}

function entry(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id: "expense_1",
    group_id: LEDGER,
    title: "早餐",
    kind: "expense",
    category: "food",
    amount_minor: 6000,
    currency: "TWD",
    expense_date: "2026-11-01",
    created_at: "2026-11-01T08:00:00.000Z",
    version: 1,
    client_request_id: `line:${KEY}`,
    expense_payments: [{ payer_member_id: "member_alice", amount_minor: 6000, currency: "TWD" }],
    expense_shares: [{ member_id: "member_alice", share_type: "equal", amount_minor: 6000 }],
    ...overrides,
  };
}

function ledgerDetail() {
  const base = groupDetail({ group: ledger(), expenses: [entry()], expense_count: 1, spend_total_minor: 6000 });
  return { ...base, members: base.members.map((member) => ({ ...member, group_id: LEDGER })) };
}

function standardRoutes() {
  // Production answers this, and the surfaces gated on it (the LINE hint among them) only wake up once it has.
  route("GET /site-notice", { notice: null, view_as: null });
  route("GET /groups", { groups: [ledger()] });
  route(`GET /groups/${LEDGER}`, ledgerDetail());
  route(`GET /groups/${LEDGER}/expenses/search`, {
    has_more: false,
    expenses: [entry()],
    match_count: 1,
    match_total_minor: 6000,
  });
  route(`GET /groups/${LEDGER}/spend-breakdown`, { periods: [] });
  route(ENTRY_ROUTE, {
    status: "live",
    group_id: LEDGER,
    expense_id: "expense_1",
    expense_date: "2026-11-01",
    edited: false,
  });
}

function context(overrides: Partial<LiffAppContext> = {}): LiffAppContext {
  return {
    session: SESSION,
    ledgerId: LEDGER,
    intent: null,
    reauthenticate: vi.fn(async () => true),
    ...overrides,
  };
}

function renderLiff(overrides: Partial<LiffAppContext> = {}, url = `/group/${LEDGER}`) {
  const ctx = context(overrides);
  window.history.replaceState(null, "", url);
  return { ctx, ...render(<App liff={ctx} />) };
}

async function ready() {
  await screen.findByText("早餐");
}

beforeEach(() => {
  // Production has both of these; without them the surfaces they switch on never render here,
  // and a LIFF-forbidden request from one of them would go unseen.
  vi.stubEnv("VITE_LINE_OA_URL", "https://line.me/R/ti/p/@test");
  stubBrowser();
  seen = [];
  routes = new Map();
  setApiBearerToken(BEARER);
  stubFetch();
  standardRoutes();
});

afterEach(() => {
  // Checked for EVERY test: whatever the scenario, nothing the App asked for
  // may be something the LIFF gate refuses, and everything carries the bearer.
  const refused = seen.filter((call) => !liffAllows(call.method, call.path, LEDGER)).map((call) => call.key);
  const bare = seen.filter((call) => call.authorization !== `Bearer ${BEARER}`).map((call) => call.key);
  cleanup();
  resetApiBearerForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  expect(refused, "requests the LIFF gate would refuse").toEqual([]);
  expect(bare, "requests without the bearer").toEqual([]);
});

describe("LIFF mode: what it asks the server for", () => {
  test("loading the ledger asks for the list and the ledger, with the bearer, and nothing else", async () => {
    renderLiff();
    await ready();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((call) => call.key)).toContain("GET /groups");
    expect(seen.map((call) => call.key)).toContain(`GET /groups/${LEDGER}`);
    for (const call of seen) {
      expect(call.authorization).toBe(`Bearer ${BEARER}`);
    }
  });

  test("the surfaces it hides never get to ask for their data", async () => {
    renderLiff();
    await ready();
    const asked = seen.map((call) => call.key).join("\n");
    expect(asked).not.toMatch(/\/me\/notifications|\/me\/push|\/me\/profile|\/invites|\/members|\/admin/);
  });
});

describe("LIFF mode: what it keeps in the browser", () => {
  test("it writes no session of its own, and the normal app's saved session is neither read nor changed", async () => {
    window.localStorage.setItem(SESSION_KEY, NORMAL_SESSION);
    window.localStorage.setItem(CACHE_KEY, NORMAL_CACHE);
    const before = { ...window.localStorage };
    renderLiff();
    await ready();
    // The cloud cache is written ~300ms after the data lands; wait it out.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    expect(window.localStorage.getItem(SESSION_KEY)).toBe(NORMAL_SESSION);
    // Nothing keyed to the LIFF user in the browser's storage either: cache and offline queue stay in memory.
    const keys = Object.keys(window.localStorage);
    expect(keys.filter((key) => key.includes("user_alice"))).toEqual([]);
    expect(window.localStorage.getItem(CACHE_KEY)).toBe(NORMAL_CACHE);
    for (const key of Object.keys(before)) expect(window.localStorage.getItem(key)).toBe(before[key]);
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain(BEARER);
    // The activity log carries titles and amounts: in memory here, never written to the browser.
    expect(window.localStorage.getItem("equo.clean.cloud_activities")).toBeNull();
  });

  test("with no saved session at all, it still writes none", async () => {
    renderLiff();
    await ready();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test("the bearer is never in the address bar", async () => {
    renderLiff();
    await ready();
    expect(window.location.href).not.toContain(BEARER);
    expect(window.location.hash).toBe("");
  });
});

describe("LIFF mode: what is on screen", () => {
  test("no navigation to other groups, profile, notifications, sign-out, or anything the token cannot use", async () => {
    const { container } = renderLiff();
    await ready();

    expect(screen.queryByLabelText(app.notifications)).toBeNull();
    expect(screen.queryByLabelText(app.profile)).toBeNull();
    expect(screen.queryByLabelText(app.groupList)).toBeNull();
    expect(screen.queryByText(app.createGroup)).toBeNull();
    expect(screen.queryByText(app.joinGroup)).toBeNull();
    expect(screen.queryByText(app.scanReceipt)).toBeNull();
    expect(screen.queryByText(UI_TEXT.profile.logout)).toBeNull();
    expect(screen.queryByText(UI_TEXT.login.googleLogin)).toBeNull();
    expect(container.querySelector(".profile-dot")).toBeNull();
    expect(container.querySelector(".group-rail")).toBeNull();
    expect(container.querySelector(".workspace-grid--no-rail")).not.toBeNull();
  });

  test("the ledger itself is there: its records are listed", async () => {
    renderLiff();
    await ready();
    expect(screen.getByRole("heading", { name: "我的帳本" })).toBeTruthy();
    expect(screen.getAllByText("$60").length).toBeGreaterThan(0);
  });
});

describe("LIFF mode: doors that are shut in code, not just hidden", () => {
  test("a sheet the chrome does not offer cannot be opened even by something that asks for it", async () => {
    // ?shortcut=join is the PWA shortcut that opens the invite-code sheet.
    renderLiff({}, `/group/${LEDGER}?shortcut=join`);
    await ready();
    await act(async () => {});
    expect(screen.queryByText(app.inviteInputTitle)).toBeNull();
    expect(screen.queryByPlaceholderText(app.inviteInputPlaceholder)).toBeNull();
  });

  test("an OAuth-looking fragment is not exchanged and is left where it is", async () => {
    renderLiff({}, `/group/${LEDGER}#access_token=LINE_SECRET&token_type=bearer`);
    await ready();
    expect(window.location.hash).toBe("#access_token=LINE_SECRET&token_type=bearer");
    expect(seen.map((call) => call.key)).not.toContain("POST /auth/supabase");
  });
});

describe("LIFF mode: the three intents", () => {
  test.each<[string, LineIntent, () => Promise<unknown>]>([
    ["records", { kind: "records" }, () => screen.findByLabelText(UI_TEXT.records.searchLabel)],
    ["analysis", { kind: "analysis" }, () => screen.findByText(UI_TEXT.analysis.description)],
    ["entry", { kind: "entry", entryKey: KEY }, () => screen.findByDisplayValue("早餐")],
  ])("%s comes up on its own", async (_name, intent, appears) => {
    renderLiff({ intent });
    expect(await appears()).toBeTruthy();
  });

  test("an entry opens the edit composer, exactly once, via the entry lookup the token may make", async () => {
    renderLiff({ intent: { kind: "entry", entryKey: KEY } });
    expect(await screen.findByText(app.editExpense)).toBeTruthy();
    expect(seen.filter((call) => call.key === ENTRY_ROUTE)).toHaveLength(1);
  });

  test("no intent: nothing opens by itself", async () => {
    renderLiff({ intent: null });
    await ready();
    expect(screen.queryByText(app.editExpense)).toBeNull();
    expect(screen.queryByLabelText(UI_TEXT.records.searchLabel)).toBeNull();
  });
});

describe("LIFF mode: edit and delete", () => {
  test("saving an edit PUTs the entry under the token's own ledger", async () => {
    route(`PUT /groups/${LEDGER}/expenses/expense_1`, { expense: entry({ title: "早餐（改）" }) });
    renderLiff({ intent: { kind: "entry", entryKey: KEY } });

    const title = (await screen.findByDisplayValue("早餐")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "早餐（改）" } });
    const composer = screen.getByRole("dialog", { name: app.addExpense });
    const submit = within(composer)
      .getAllByRole("button", { name: app.saveChanges })
      .find((button) => button.className.includes("composer-submit"));
    fireEvent.click(submit as HTMLElement);

    await waitFor(() => expect(seen.map((call) => call.key)).toContain(`PUT /groups/${LEDGER}/expenses/expense_1`));
  });

  test("changing the amount of an entry still lets it be saved (it used to switch 儲存變更 off)", async () => {
    route(`PUT /groups/${LEDGER}/expenses/expense_1`, { expense: entry({ amount_minor: 12000 }) });
    renderLiff({ intent: { kind: "entry", entryKey: KEY } });

    await screen.findByDisplayValue("早餐");
    const composer = screen.getByRole("dialog", { name: app.addExpense });
    fireEvent.change(within(composer).getByLabelText(app.amount), { target: { value: "120" } });
    const submit = within(composer)
      .getAllByRole("button", { name: app.saveChanges })
      .find((button) => button.className.includes("composer-submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(seen.map((call) => call.key)).toContain(`PUT /groups/${LEDGER}/expenses/expense_1`));
    const put = seen.find((call) => call.key === `PUT /groups/${LEDGER}/expenses/expense_1`);
    // The server refuses shares or payments that do not add up to the amount, and this mock would not.
    expect(JSON.parse(String(put?.body))).toMatchObject({
      amount_minor: 12000,
      expense_payments: [{ payer_member_id: "member_alice", amount_minor: 12000 }],
      expense_shares: [{ member_id: "member_alice", amount_minor: 12000 }],
    });
  });

  test("deleting from the detail DELETEs the entry under the token's own ledger", async () => {
    route(`DELETE /groups/${LEDGER}/expenses/expense_1`, { expense: { id: "expense_1" } });
    renderLiff({ intent: { kind: "records" } });

    const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
    const panel = search.closest(".panel-dialog") as HTMLElement;
    fireEvent.change(search, { target: { value: "早" } });
    const row = await within(panel).findByText("早餐");
    fireEvent.click(row.closest(".record-dialog-row")!);
    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });

    fireEvent.click(screen.getByRole("button", { name: app.deleteExpense }));
    // findBy: a background refresh between the two clicks re-arms the button, so wait for it.
    fireEvent.click(await screen.findByRole("button", { name: app.confirmDelete }));

    await waitFor(() => expect(seen.map((call) => call.key)).toContain(`DELETE /groups/${LEDGER}/expenses/expense_1`));
  });
});

describe("LIFF mode: the token stops working", () => {
  test("a 401 asks the page for a new session - once, however many requests failed", async () => {
    route("GET /groups", { error: { code: "UNAUTHENTICATED", message: "no" } }, 401);
    const reauthenticate = vi.fn(async () => true);
    renderLiff({ reauthenticate });
    await waitFor(() => expect(reauthenticate).toHaveBeenCalled());
    await act(async () => {});
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("when no new session can be had, the app ends quietly: no Google login wall, no storage touched", async () => {
    window.localStorage.setItem(SESSION_KEY, NORMAL_SESSION);
    route("GET /groups", { error: { code: "UNAUTHENTICATED", message: "no" } }, 401);
    const reauthenticate = vi.fn(async () => false);
    const { container } = renderLiff({ reauthenticate });

    await waitFor(() => expect(reauthenticate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector(".workspace-grid")).toBeNull());

    expect(screen.queryByText(UI_TEXT.login.googleLogin)).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(NORMAL_SESSION);
  });
});

describe("the ordinary app is unchanged", () => {
  test("with no LIFF context it is the login wall, as ever, and sends no bearer", async () => {
    resetApiBearerForTests();
    window.history.replaceState(null, "", "/");
    render(<App />);
    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    expect(seen.every((call) => call.authorization === undefined)).toBe(true);
    // Restore for the shared afterEach, which expects the bearer on whatever was seen.
    seen = [];
  });
});
