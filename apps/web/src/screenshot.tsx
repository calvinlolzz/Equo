/**
 * Dev-only entry that mounts the REAL app against a fabricated group, so the
 * store-listing screenshots in site.webmanifest can be taken from the actual UI.
 *
 * Why this exists rather than "just take a screenshot of the app":
 *
 * - The app is behind a hard login wall, so there is no signed-in screen to
 *   photograph without an account.
 * - A screenshot of a real group is a photograph of real people's names and
 *   real amounts, published in an install prompt. That is not ours to publish.
 * - A hand-drawn mockup would drift from the product the first time the UI
 *   moved, and the whole complaint about the previous screenshots was that they
 *   did not show the product.
 *
 * So: the app's own components and layout, with invented people (小明 / 小美 /
 * 阿哲) and invented amounts. Everything below the fetch stub is the shipped
 * code path — App, the cloud store, the hooks, the CSS.
 *
 * NOT part of the production build: Vite's default build entry is index.html
 * alone, so screenshot.html and this module never reach dist/. There is a test
 * (screenshotHarness.test.ts) that fails if that stops being true.
 *
 * To retake the screenshots:
 *   npm --workspace apps/web run dev   →   http://localhost:14100/screenshot.html
 * then capture 390×844 (narrow) and 1280×800 (wide) into public/screenshots/.
 *
 * The landing page's hero shot is the top 390×416 of the narrow screen, and it
 * needs two things the store screenshots do not:
 *
 * - deviceScaleFactor 2, so the 780×832 source exists for hero-home@2x.webp.
 *   The 1x file is a Lanczos downscale of that same capture rather than a
 *   second one, so the pair is the same frame at two densities.
 * - prefers-reduced-motion: reduce, which freezes the animated backdrop. Its
 *   blobs seed their position, phase and hue from Math.random at module load,
 *   so without this every capture is a different colour behind the glass —
 *   twelve seeded runs came out between 141 and 190 mean card luminance, i.e.
 *   white text on a bright wash. Frozen it lands at 101, which is where the
 *   text is legible.
 *
 * Also hide the scrollbar (`html{scrollbar-width:none}`): desktop Chromium
 * draws a classic one that eats 15px of layout width and a phone has none.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "./app/App.css";
import { App } from "./app/App";
import { dismissAppSplash } from "./app/appSplash";
import { initTheme } from "./app/themeStore";
import { DEFAULT_CATALOG } from "./app/catalog";
import { daysAgo } from "./screenshotDates";
import type { GroupDetail, GroupSummary } from "./app/apiClient";

const GROUP_ID = "group_demo";
const CURRENCY = "TWD";

/** Whole units, spelled out here so the fixtures read like money and not like cents. */
function nt(amount: number): number {
  return Math.round(amount * 100);
}

const MEMBERS: GroupDetail["members"] = [
  { id: "m_me", group_id: GROUP_ID, user_id: "u_me", display_name: "我", role: "owner", status: "active" },
  { id: "m_ming", group_id: GROUP_ID, user_id: "u_ming", display_name: "小明", role: "member", status: "active" },
  { id: "m_mei", group_id: GROUP_ID, user_id: "u_mei", display_name: "小美", role: "member", status: "active" },
  { id: "m_jay", group_id: GROUP_ID, user_id: null, display_name: "阿哲", role: "member", status: "active" },
];

const EVERYONE = MEMBERS.map((member) => member.id);

function expense(
  id: string,
  title: string,
  category: string,
  amount: number,
  payer: string,
  days: number,
  shareIds: string[] = EVERYONE,
): GroupDetail["expenses"][number] {
  const total = nt(amount);
  const each = Math.round(total / shareIds.length);

  return {
    id,
    group_id: GROUP_ID,
    title,
    kind: "expense",
    category,
    amount_minor: total,
    currency: CURRENCY,
    expense_date: daysAgo(days),
    note: null,
    image_urls: [],
    created_at: `${daysAgo(days)}T12:00:00.000Z`,
    version: 1,
    client_request_id: `demo_${id}`,
    expense_payments: [{ payer_member_id: payer, amount_minor: total, currency: CURRENCY }],
    // The last share absorbs the rounding remainder, the same way the composer
    // does it — a fixture that does not add up would render a wrong balance.
    expense_shares: shareIds.map((memberId, index) => ({
      member_id: memberId,
      share_type: "even",
      amount_minor: index === shareIds.length - 1 ? total - each * (shareIds.length - 1) : each,
    })),
  };
}

const EXPENSES = [
  expense("e1", "居酒屋", "food", 2400, "m_ming", 0),
  expense("e2", "地鐵一日券", "transport", 1600, "m_me", 1),
  expense("e3", "民宿兩晚", "lodging", 8600, "m_me", 2),
  expense("e4", "藥妝店", "shopping", 3200, "m_mei", 2, ["m_mei", "m_jay"]),
  expense("e5", "拉麵", "food", 960, "m_jay", 3),
  expense("e6", "機場快線", "transport", 1300, "m_me", 4),
];

/** Balances are derived from the fixtures rather than typed in, so they agree. */
function balances(): GroupDetail["balances"] {
  const totals = new Map(MEMBERS.map((member) => [member.id, 0]));

  for (const entry of EXPENSES) {
    for (const payment of entry.expense_payments ?? []) {
      totals.set(payment.payer_member_id, (totals.get(payment.payer_member_id) ?? 0) + payment.amount_minor);
    }
    for (const share of entry.expense_shares ?? []) {
      totals.set(share.member_id, (totals.get(share.member_id) ?? 0) - share.amount_minor);
    }
  }

  return MEMBERS.map((member) => ({
    memberId: member.id,
    balance: { amount_minor: totals.get(member.id) ?? 0, currency: CURRENCY },
  }));
}

function spendByCategory(): GroupDetail["spend_by_category"] {
  const totals = new Map<string, number>();
  for (const entry of EXPENSES) {
    totals.set(entry.category ?? "other", (totals.get(entry.category ?? "other") ?? 0) + entry.amount_minor);
  }
  return [...totals.entries()]
    .map(([category, total_minor]) => ({ category, total_minor }))
    .sort((a, b) => b.total_minor - a.total_minor);
}

/**
 * Per-member daily shares. Empty here would not read as "no data" on the home
 * screen — it reads as 個人消費 $0, which is the one number the screenshot most
 * needs to be real.
 */
function memberDayShares(): GroupDetail["member_day_shares"] {
  const totals = new Map<string, number>();

  for (const entry of EXPENSES) {
    for (const share of entry.expense_shares ?? []) {
      const key = `${entry.expense_date}|${share.member_id}`;
      totals.set(key, (totals.get(key) ?? 0) + share.amount_minor);
    }
  }

  return [...totals.entries()].map(([key, share_minor]) => {
    const [day, member_id] = key.split("|");
    return { day, member_id, share_minor };
  });
}

function spendByDay(): GroupDetail["spend_by_day"] {
  const totals = new Map<string, number>();
  for (const entry of EXPENSES) {
    const day = entry.expense_date ?? daysAgo(0);
    totals.set(day, (totals.get(day) ?? 0) + entry.amount_minor);
  }
  return [...totals.entries()].map(([day, total_minor]) => ({ day, total_minor })).sort((a, b) => a.day.localeCompare(b.day));
}

const GROUP: GroupSummary = {
  id: GROUP_ID,
  name: "東京旅行",
  currency: CURRENCY,
  owner_member_id: "m_me",
  // A deliberately TALL fixture (3:4, like a phone photo): the cover is a 16:9
  // box, so this is what proves the drawer stays usable instead of being eaten
  // by somebody's portrait snapshot.
  cover_image_url:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%236de2b8'/%3E%3Cstop offset='0.5' stop-color='%238e7cf0'/%3E%3Cstop offset='1' stop-color='%23ffd67a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='300' height='400' fill='url(%23g)'/%3E%3Ctext x='150' y='60' font-size='28' text-anchor='middle' fill='%23000'%3ETOP%3C/text%3E%3Ctext x='150' y='210' font-size='28' text-anchor='middle' fill='%23000'%3EMIDDLE%3C/text%3E%3Ctext x='150' y='370' font-size='28' text-anchor='middle' fill='%23000'%3EBOTTOM%3C/text%3E%3C/svg%3E",
};

const DETAIL: GroupDetail = {
  group: GROUP,
  members: MEMBERS,
  expenses: EXPENSES,
  balances: balances(),
  expense_count: EXPENSES.length,
  spend_total_minor: EXPENSES.reduce((sum, entry) => sum + entry.amount_minor, 0),
  spend_by_day: spendByDay(),
  spend_by_category: spendByCategory(),
  member_day_shares: memberDayShares(),
};

/**
 * The analysis panel's own aggregates. Derived from the same fixtures rather
 * than typed in: an unstubbed route here renders 總計 $非數值, which is a fine
 * way to notice a gap and a terrible thing to photograph.
 */
function spendBreakdown() {
  const year = new Date().getFullYear();
  const me = "m_me";
  const personalOf = (entry: (typeof EXPENSES)[number]) =>
    (entry.expense_shares ?? []).find((share) => share.member_id === me)?.amount_minor ?? 0;

  const groupTotal = EXPENSES.reduce((sum, entry) => sum + entry.amount_minor, 0);
  const personalTotal = EXPENSES.reduce((sum, entry) => sum + personalOf(entry), 0);

  const byCategory = new Map<string, { group: number; personal: number }>();
  for (const entry of EXPENSES) {
    const key = entry.category ?? "other";
    const row = byCategory.get(key) ?? { group: 0, personal: 0 };
    row.group += entry.amount_minor;
    row.personal += personalOf(entry);
    byCategory.set(key, row);
  }

  return {
    period_kind: "year",
    period_key: String(year),
    currency: CURRENCY,
    // Two periods, so the 跟上期比 comparison has something to compare against.
    periods: [
      { key: String(year), total_minor: groupTotal, personal_total_minor: personalTotal },
      { key: String(year - 1), total_minor: Math.round(groupTotal * 0.72), personal_total_minor: Math.round(personalTotal * 0.68) },
    ],
    group_total_minor: groupTotal,
    personal_total_minor: personalTotal,
    by_category: [...byCategory.entries()]
      .map(([category, row]) => ({ category, group_total_minor: row.group, personal_total_minor: row.personal }))
      .sort((a, b) => b.group_total_minor - a.group_total_minor),
  };
}

/**
 * `?invite=` renders the SIGNED-OUT landing page with a live invite card
 * instead of the app: no session is seeded, and the preview route answers. It
 * is the one screen that cannot be reached by just opening the dev server —
 * there is no API there, so the real page silently falls back to the ordinary
 * landing (which is correct behaviour, and useless for looking at the card).
 */
const previewInvite = new URLSearchParams(window.location.search).get("invite");

const ROUTES: Record<string, unknown> = {
  "GET /site-notice": { notice: { banner: { message: "", level: "info", ends_at: null, active: false }, maintenance: { enabled: false, message: "" } }, view_as: null },
  "GET /groups": { groups: [GROUP] },
  [`GET /groups/${GROUP_ID}`]: DETAIL,
  "GET /notifications": { notifications: [], unread_count: 0 },
  "GET /me": { user: { id: "u_me", email: "demo@example.com", display_name: "我" } },
  "GET /catalog": DEFAULT_CATALOG,
  [`GET /groups/${GROUP_ID}/spend-breakdown`]: spendBreakdown(),
  [`GET /groups/${GROUP_ID}/expenses/search`]: { expenses: EXPENSES, total: EXPENSES.length },
  ...(previewInvite
    ? { [`GET /invites/${previewInvite}/preview`]: { group: { name: GROUP.name, member_count: MEMBERS.length } } }
    : {}),
};


if (!previewInvite) {
  window.localStorage.setItem(
    "equo.clean.session",
    JSON.stringify({
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "u_me", email: "demo@example.com", displayName: "我" },
    }),
  );
}

// The boundary, and only the boundary. An unlisted route answers with an empty
// object and says so in the console rather than throwing: the app treats its own
// refresh failures as a toast, and a toast in the middle of a screenshot is
// worse than a section that renders empty.
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const path = String(typeof input === "string" ? input : input.toString()).replace(/^\/api\/v1/, "").split("?")[0];
  const key = `${method} ${path}`;
  const body = ROUTES[key];

  if (body === undefined) {
    console.warn("[screenshot] unstubbed route", key);
  }

  return { ok: true, status: 200, json: async () => body ?? {} } as Response;
}) as typeof window.fetch;

initTheme();

const root = document.getElementById("root");
if (!root) throw new Error("screenshot harness root is missing");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

requestAnimationFrame(() => requestAnimationFrame(() => dismissAppSplash()));
