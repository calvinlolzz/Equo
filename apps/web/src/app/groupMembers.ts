import type { GroupMemberSummary } from "./apiClient";
import { UI_TEXT } from "./uiText";

export function getGroupMemberPanel({
  members,
  ownerMemberId,
  inviteCode,
}: {
  members: GroupMemberSummary[];
  ownerMemberId: string | undefined;
  inviteCode: string;
}) {
  const activeMembers = members.filter((member) => member.status === "active");
  const owner = activeMembers.find((member) => member.id === ownerMemberId || member.role === "owner");

  return {
    activeMemberCount: activeMembers.length,
    ownerName: owner?.display_name ?? UI_TEXT.members.ownerFallback,
    inviteActionLabel: inviteCode.trim() ? UI_TEXT.members.updateInvite : UI_TEXT.members.createInvite,
    inviteCodeVisible: inviteCode.trim().length > 0,
  };
}
