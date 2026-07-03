import { describe, expect, test } from "vitest";
import { getGroupMemberPanel } from "./groupMembers";
import type { GroupMemberSummary } from "./apiClient";

const members: GroupMemberSummary[] = [
  {
    id: "owner_1",
    group_id: "group_1",
    user_id: "user_1",
    display_name: "Calvin",
    role: "owner",
    status: "active",
  },
  {
    id: "member_2",
    group_id: "group_1",
    user_id: null,
    display_name: "Mina",
    role: "member",
    status: "active",
  },
];

describe("getGroupMemberPanel", () => {
  test("summarizes active members and owner for the member management panel", () => {
    expect(getGroupMemberPanel({ members, ownerMemberId: "owner_1", inviteCode: "" })).toEqual({
      activeMemberCount: 2,
      ownerName: "Calvin",
      inviteActionLabel: "產生邀請碼",
      inviteCodeVisible: false,
    });
  });

  test("switches the invite action after an invite code exists", () => {
    expect(getGroupMemberPanel({ members, ownerMemberId: "owner_1", inviteCode: "EQO123" })).toMatchObject({
      inviteActionLabel: "更新邀請碼",
      inviteCodeVisible: true,
    });
  });
});
