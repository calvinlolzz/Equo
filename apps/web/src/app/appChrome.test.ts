import { describe, expect, test } from "vitest";
import { dialogAllowed, resolveAppChrome, type AppChrome } from "./appChrome";
import type { DialogMode } from "./appTypes";

const FLAGS = [
  "groupNavigation",
  "profile",
  "notifications",
  "installHint",
  "lineHint",
  "feedback",
  "receiptScan",
  "groupMenu",
  "signOut",
  "landing",
  "localSession",
] as const satisfies ReadonlyArray<keyof AppChrome>;

const ALL_DIALOGS: Array<NonNullable<DialogMode>> = [
  "createGroup",
  "editGroup",
  "inviteMembers",
  "inviteInput",
  "recordsPanel",
  "analysisPanel",
  "memberActions",
  "memberList",
  "recurringList",
  "virtualMember",
  "archivedList",
  "archive",
  "delete",
  "profile",
];

describe("the full chrome (every route but /liff)", () => {
  test("is the default, and shows everything", () => {
    expect(resolveAppChrome()).toBe(resolveAppChrome("full"));
    const chrome = resolveAppChrome();
    for (const flag of FLAGS) expect(chrome[flag], flag).toBe(true);
    expect(chrome.dialogs).toBeNull();
  });

  test("opens every sheet", () => {
    for (const mode of ALL_DIALOGS) expect(dialogAllowed(resolveAppChrome("full"), mode), mode).toBe(true);
  });
});

describe("the LIFF chrome", () => {
  const chrome = resolveAppChrome("liff");

  test("hides every surface the LIFF token cannot use", () => {
    for (const flag of FLAGS) expect(chrome[flag], flag).toBe(false);
  });

  test("opens only 明細 and 分析, and always allows closing", () => {
    const allowed = ALL_DIALOGS.filter((mode) => dialogAllowed(chrome, mode));
    expect(allowed).toEqual(["recordsPanel", "analysisPanel"]);
    expect(dialogAllowed(chrome, null)).toBe(true);
  });

  test("cannot be mutated into something wider", () => {
    expect(Object.isFrozen(chrome)).toBe(true);
    expect(Object.isFrozen(resolveAppChrome("full"))).toBe(true);
  });
});
