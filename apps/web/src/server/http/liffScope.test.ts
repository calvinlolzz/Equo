import { describe, expect, test } from "vitest";
import { liffAllows } from "./liffScope.js";

const L = "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10";
const OTHER = "11111111-2222-4333-8444-555555555555";
const E = "5d1f6e7a-0c2b-4d3e-8f41-a1b2c3d4e5f6";
const KEY = "msg:123456789012";
const KEY_ENCODED = "msg%3A123456789012";

const API = "/api/v1";

const ALLOWED: Array<[string, string]> = [
  ["GET", `${API}/site-notice`],
  ["GET", `${API}/catalog`],
  ["GET", `${API}/exchange-rates`],
  ["GET", `${API}/line/liff`],
  ["GET", `${API}/groups`],
  ["GET", `${API}/groups/${L}`],
  ["GET", `${API}/groups/${L}/expenses`],
  ["GET", `${API}/groups/${L}/expenses/search`],
  ["GET", `${API}/groups/${L}/spend-breakdown`],
  ["GET", `${API}/groups/${L}/recurring`],
  ["GET", `${API}/groups/${L}/expenses/${E}/comments`],
  ["GET", `${API}/groups/${L}/expenses/expense_1/comments`],
  ["GET", `${API}/me/line/entries/${KEY_ENCODED}`],
  ["GET", `${API}/me/line/entries/abcdefgh12`],
  ["GET", `${API}/me/line/entries/${KEY}`],
  ["POST", `${API}/groups/${L}/expenses`],
  ["POST", `${API}/groups/${L}/images`],
  ["POST", `${API}/groups/${L}/read`],
  ["POST", `${API}/errors`],
  ["PUT", `${API}/groups/${L}/expenses/${E}`],
  ["DELETE", `${API}/groups/${L}/expenses/${E}`],
];

// Each of these is a real endpoint or a real trick; every one must be refused.
const DENIED: Array<[string, string, string]> = [
  // The admin console, account deletion and everything under /me except the entry lookup
  ["GET", `${API}/admin/me`, "admin"],
  ["GET", `${API}/admin/users`, "admin"],
  ["POST", `${API}/admin/view-as`, "admin"],
  ["DELETE", `${API}/admin/view-as`, "admin"],
  ["POST", `${API}/admin/exports`, "admin"],
  ["DELETE", `${API}/me`, "account deletion"],
  ["GET", `${API}/me`, "me"],
  ["GET", `${API}/me/line`, "me/line"],
  ["POST", `${API}/me/line/link`, "me/line/link"],
  ["DELETE", `${API}/me/line`, "unlink"],
  ["PATCH", `${API}/me/avatar`, "avatar"],
  ["PUT", `${API}/me/avatar`, "avatar"],
  ["GET", `${API}/me/line/entries`, "no key"],
  ["GET", `${API}/me/line/entries/`, "empty key"],
  ["POST", `${API}/me/line/entries/${KEY_ENCODED}`, "entry key with the wrong method"],
  ["DELETE", `${API}/me/line/entries/${KEY_ENCODED}`, "entry key with the wrong method"],
  ["GET", `${API}/me/line/entries/short`, "key under 8 characters"],
  ["GET", `${API}/me/line/entries/${"a".repeat(81)}`, "key over 80 characters"],
  ["GET", `${API}/me/line/entries/abc%2Fdefghijkl`, "encoded slash in a key"],
  ["GET", `${API}/me/line/entries/abc%2edefghijkl`, "encoded dot in a key"],
  ["GET", `${API}/me/line/entries/abcdefgh12/extra`, "key with a trailing segment"],
  ["GET", `${API}/me/line/entries/abcdefgh12.`, "key with a dot"],
  // Group management that is not "the ledger's entries"
  ["PATCH", `${API}/groups/${L}`, "edit the group"],
  ["PUT", `${API}/groups/${L}`, "group with the wrong method"],
  ["DELETE", `${API}/groups/${L}`, "delete the group"],
  ["POST", `${API}/groups`, "create a group"],
  ["GET", `${API}/groups/archived`, "archived list"],
  ["POST", `${API}/groups/${L}/archive`, "archive"],
  ["POST", `${API}/groups/${L}/unarchive`, "unarchive"],
  ["POST", `${API}/groups/${L}/invites`, "invites"],
  ["POST", `${API}/groups/${L}/members`, "members"],
  ["PATCH", `${API}/groups/${L}/members/m1`, "member rename"],
  ["PUT", `${API}/groups/${L}/members/m1/payment-note`, "payment note"],
  ["DELETE", `${API}/groups/${L}/members/m1`, "member removal"],
  ["POST", `${API}/groups/${L}/members/m1/nudge`, "nudge"],
  ["POST", `${API}/groups/${L}/recurring`, "recurring write"],
  ["DELETE", `${API}/groups/${L}/recurring/r1`, "recurring delete"],
  ["POST", `${API}/groups/${L}/expenses/${E}/comments`, "comment write"],
  ["DELETE", `${API}/groups/${L}/expenses/${E}/comments/c1`, "comment delete"],
  ["PATCH", `${API}/groups/${L}/expenses/${E}`, "expense with the wrong method"],
  ["POST", `${API}/groups/${L}/expenses/${E}`, "expense with the wrong method"],
  ["GET", `${API}/groups/${L}/expenses/${E}`, "single expense GET (not a route; deny)"],
  ["GET", `${API}/groups/${L}/members`, "members GET"],
  ["PUT", `${API}/groups/${L}/expenses`, "collection with the wrong method"],
  ["DELETE", `${API}/groups/${L}/expenses`, "collection with the wrong method"],
  ["POST", `${API}/groups/${L}/expenses/search`, "search with the wrong method"],
  ["POST", `${API}/groups/${L}/spend-breakdown`, "breakdown with the wrong method"],
  ["PUT", `${API}/groups/${L}/read`, "read with the wrong method"],
  ["GET", `${API}/groups/${L}/read`, "read with the wrong method"],
  ["POST", `${API}/groups/${L}`, "group with the wrong method"],
  ["GET", `${API}/groups/${L}/images`, "images with the wrong method"],
  // Everything else with a door on it
  ["POST", `${API}/receipts/scan`, "receipt scan"],
  ["GET", `${API}/push/public-key`, "push"],
  ["POST", `${API}/push/subscribe`, "push"],
  ["POST", `${API}/push/unsubscribe`, "push"],
  ["GET", `${API}/notifications`, "notifications"],
  ["POST", `${API}/notifications/read`, "notifications"],
  ["DELETE", `${API}/notifications`, "notifications"],
  ["POST", `${API}/feedback`, "feedback"],
  ["POST", `${API}/auth/google`, "auth"],
  ["POST", `${API}/auth/supabase`, "auth"],
  ["POST", `${API}/auth/line`, "auth"],
  ["POST", `${API}/internal/run-nudges`, "scheduler"],
  ["GET", `${API}/health`, "health"],
  ["GET", `${API}/invites/tok/preview`, "invite preview"],
  ["POST", `${API}/invites/tok/accept`, "invite accept"],
  ["GET", `${API}/nope`, "unknown"],
  ["POST", `${API}/line/liff`, "config with the wrong method"],
  ["POST", `${API}/site-notice`, "site-notice with the wrong method"],
  ["PUT", `${API}/catalog`, "catalog with the wrong method"],
  ["GET", `${API}/errors`, "errors with the wrong method"],
  ["GET", "/", "root"],
  ["GET", "", "empty"],
  // Another ledger, a prefix of the ledger, a ledger plus something
  ["GET", `${API}/groups/${OTHER}`, "another ledger"],
  ["GET", `${API}/groups/${OTHER}/expenses`, "another ledger"],
  ["POST", `${API}/groups/${OTHER}/expenses`, "another ledger"],
  ["PUT", `${API}/groups/${OTHER}/expenses/${E}`, "another ledger"],
  ["DELETE", `${API}/groups/${OTHER}/expenses/${E}`, "another ledger"],
  ["POST", `${API}/groups/${OTHER}/images`, "another ledger"],
  ["POST", `${API}/groups/${OTHER}/read`, "another ledger"],
  ["GET", `${API}/groups/${L.slice(0, 8)}/expenses`, "a prefix of the ledger id"],
  ["GET", `${API}/groups/${L}x/expenses`, "ledger id with a suffix"],
  ["GET", `${API}/groups/x${L}/expenses`, "ledger id with a prefix"],
  ["GET", `${API}/groups/${L.toUpperCase()}/expenses`, "ledger id in another case"],
  ["GET", `${API}/groups/${L}${OTHER}/expenses`, "two ledger ids"],
  // Path tricks
  ["GET", `${API}/groups/${L}/../x`, "dot-dot after the ledger"],
  ["GET", `${API}/groups/${L}/expenses/..`, "dot-dot as an id"],
  ["DELETE", `${API}/groups/${L}/expenses/..`, "dot-dot as an id"],
  ["PUT", `${API}/groups/${L}/expenses/.`, "dot as an id"],
  ["GET", `${API}/groups/${L}/../../admin/me`, "traversal to admin"],
  ["GET", `${API}/groups/${L}/%2e%2e/admin/me`, "encoded traversal"],
  ["GET", `${API}/groups/${L}%2Fexpenses`, "encoded slash instead of a slash"],
  ["GET", `${API}/groups/${L}/expenses%2F${E}/comments`, "encoded slash in an id"],
  ["PUT", `${API}/groups/${L}/expenses/${E}%2Fx`, "encoded slash after an id"],
  ["PUT", `${API}/groups/${L}/expenses/%2e%2e`, "encoded dots as an id"],
  ["GET", `${API}/groups/${L}/expenses/${E}%00/comments`, "NUL in an id"],
  ["GET", `${API}/groups/%4c/expenses`, "encoded ledger"],
  ["GET", `${API}/groups/${L}/expenses/`, "trailing slash"],
  ["GET", `${API}/groups/${L}/`, "trailing slash on the group"],
  ["GET", `${API}/groups/`, "trailing slash on the list"],
  ["GET", `${API}/groups//${L}/expenses`, "double slash"],
  ["GET", `${API}//groups/${L}/expenses`, "double slash"],
  ["GET", `${API}/groups/${L}/expenses/search/`, "trailing slash on search"],
  ["GET", `${API}/groups/${L}/expenses/search/x`, "trailing segment on search"],
  ["GET", `${API}/groups/${L}/expenses/${E}/comments/extra`, "trailing segment on comments"],
  ["PUT", `${API}/groups/${L}/expenses/${E}/extra`, "trailing segment on an expense"],
  ["DELETE", `${API}/groups/${L}/expenses/${E}/comments/c1`, "comment delete via expense path"],
  ["GET", `${API}/groups/${L}/expenses?limit=5`, "query string in the path"],
  ["GET", `${API}/groups?x=1`, "query string on the list"],
  ["GET", `${API}/groups/${L}/expenses#frag`, "fragment in the path"],
  ["GET", `${API}/groups/${L}/expenses\n`, "newline after the path"],
  ["GET", ` ${API}/groups`, "leading space"],
  ["GET", `${API}/groups `, "trailing space"],
  ["GET", `/api/v2/groups`, "another API version"],
  ["GET", `/x/api/v1/groups`, "path that merely contains an allowed one"],
  ["GET", `${API}/groups/${L}/expenses/${"a".repeat(65)}/comments`, "overlong id"],
  ["GET", "https://evil.example/api/v1/groups", "absolute URL"],
  // A pattern that is only anchored at one end would let any of these through
  ["GET", `${API}/site-notice/x`, "trailing segment on site-notice"],
  ["GET", `${API}/catalog/x`, "trailing segment on catalog"],
  ["GET", `${API}/catalog-admin`, "suffix on catalog"],
  ["GET", `${API}/exchange-rates/x`, "trailing segment on exchange-rates"],
  ["GET", `${API}/line/liff/x`, "trailing segment on the LIFF config"],
  ["GET", `${API}/line/liffx`, "suffix on the LIFF config"],
  ["POST", `${API}/errors/x`, "trailing segment on errors"],
  ["GET", `${API}/groups/${L}/expenses/search/x`, "trailing segment on search"],
  ["GET", `/x${API}/site-notice`, "prefix on site-notice"],
  ["GET", `/x${API}/groups/${L}`, "prefix on the ledger"],
  ["GET", `/x${API}/groups/${L}/expenses`, "prefix on expenses"],
  ["POST", `/x${API}/groups/${L}/expenses`, "prefix on expense create"],
  ["DELETE", `/x${API}/groups/${L}/expenses/${E}`, "prefix on expense delete"],
  ["GET", `/x${API}/me/line/entries/${KEY_ENCODED}`, "prefix on the entry lookup"],
  // Methods
  ["get", `${API}/groups`, "lower-case method"],
  ["HEAD", `${API}/groups`, "HEAD"],
  ["OPTIONS", `${API}/groups`, "OPTIONS"],
  ["PATCH", `${API}/errors`, "PATCH errors"],
  ["", `${API}/groups`, "empty method"],
];

describe("liffAllows", () => {
  test.each(ALLOWED)("allows %s %s", (method, path) => {
    expect(liffAllows(method, path, L)).toBe(true);
  });

  // [MV]: delete any deny row's protection (loosen an anchor, add a route) and its row goes red.
  test.each(DENIED)("denies %s %s (%s)", (method, path) => {
    expect(liffAllows(method, path, L)).toBe(false);
  });

  test("every allowed per-ledger request is refused for a token minted for another ledger", () => {
    for (const [method, path] of ALLOWED) {
      if (!path.includes(L)) continue;
      expect(liffAllows(method, path, OTHER), `${method} ${path}`).toBe(false);
    }
  });

  test("the same request is allowed for each token's own ledger and only that one", () => {
    const path = `${API}/groups/${OTHER}/expenses`;

    expect(liffAllows("GET", path, OTHER)).toBe(true);
    expect(liffAllows("GET", path, L)).toBe(false);
  });

  test("a ledger id that is not a well-formed uuid allows nothing - not even the fixed routes", () => {
    for (const bad of ["", "group_1", ".*", `${L}.*`, "(", "a|b", `${L}/..`, L.slice(0, 35), `${L}0`]) {
      for (const [method, path] of ALLOWED) {
        expect(liffAllows(method, path, bad), `${method} ${path} with ledger ${JSON.stringify(bad)}`).toBe(false);
      }
    }
  });

  test("the ledger id is matched literally, not as a pattern", () => {
    // A uuid has no regex metacharacters besides '-', but the guard is that a
    // ledger id is never interpreted: a different uuid must not match this one.
    expect(liffAllows("GET", `${API}/groups/${OTHER}`, L)).toBe(false);
    expect(liffAllows("GET", `${API}/groups/${L.replace(/[0-9a-f]/g, "0")}`, L)).toBe(false);
  });

  test("non-string arguments are refused instead of thrown on", () => {
    expect(liffAllows(undefined as unknown as string, `${API}/groups`, L)).toBe(false);
    expect(liffAllows("GET", undefined as unknown as string, L)).toBe(false);
    expect(liffAllows("GET", `${API}/groups`, undefined as unknown as string)).toBe(false);
  });
});
