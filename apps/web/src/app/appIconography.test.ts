import { describe, expect, it } from "vitest";
import { ACTION_ICON_NAMES, COMPOSER_MODE_ICON_NAMES, PROFILE_ICON_NAMES, SIDE_NAV_ICON_NAMES } from "./appIconography";

describe("app iconography", () => {
  it("matches Pizo-like group navigation semantics", () => {
    expect(SIDE_NAV_ICON_NAMES).toEqual({
      home: "House",
      currency: "CircleDollarSign",
      records: "History",
      analysis: "ChartNoAxesColumn",
      members: "UserRound",
    });
  });

  it("keeps the composer mode icons aligned to the flow purpose", () => {
    expect(COMPOSER_MODE_ICON_NAMES).toEqual({
      expense: "ReceiptText",
      income: "HandCoins",
      transfer: "ArrowLeftRight",
    });
  });

  it("documents icon choices for the primary user actions", () => {
    expect(ACTION_ICON_NAMES).toMatchObject({
      createGroup: "Plus",
      joinInvite: "Ticket",
      addMember: "Plus",
      inviteMember: "Inbox",
      calculateSettlement: "Calculator",
      copy: "Copy",
      viewAll: "ChevronRight",
      floatingAdd: "Plus",
      close: "X",
      openGroupDrawer: "Menu",
      openGroupSettings: "Settings",
    });
  });

  it("documents the profile dialog icon choices", () => {
    expect(PROFILE_ICON_NAMES).toEqual({
      editName: "Pencil",
      logout: "LogOut",
      appleAccount: "Apple",
      switchTheme: "Contrast",
      languageSetting: "Globe",
      privacyPolicy: "Lock",
      termsOfService: "FileText",
    });
  });
});
