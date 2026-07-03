import type { GroupDetail, GroupMemberSummary, GroupSummary } from "./apiClient";

export type OptimisticSnapshot = {
  groups: GroupSummary[];
  activeGroup: GroupSummary | null;
};

type CreateGroupDraft = {
  name: string;
  currency: string;
  temporaryId: string;
};

function limitGroups(groups: GroupSummary[]) {
  return groups.slice(0, 8);
}

export function createOptimisticGroup(draft: CreateGroupDraft): GroupSummary {
  return {
    id: draft.temporaryId,
    name: draft.name,
    currency: draft.currency,
    owner_member_id: draft.temporaryId.replace("group", "owner"),
  };
}

export function createOptimisticOwnerMember(group: GroupSummary, displayName: string): GroupMemberSummary {
  return {
    id: group.owner_member_id,
    group_id: group.id,
    user_id: "optimistic_user",
    display_name: displayName,
    role: "owner",
    status: "active",
  };
}

export function isOptimisticGroupId(groupId: string) {
  return groupId.startsWith("optimistic_group_");
}

export function applyOptimisticCreateGroup(groups: GroupSummary[], draft: CreateGroupDraft): OptimisticSnapshot {
  const group = createOptimisticGroup(draft);
  return {
    groups: limitGroups([group, ...groups.filter((item) => item.id !== group.id)]),
    activeGroup: group,
  };
}

export function confirmOptimisticCreateGroup(
  groups: GroupSummary[],
  temporaryId: string,
  serverGroup: GroupSummary,
): OptimisticSnapshot {
  return {
    groups: limitGroups([serverGroup, ...groups.filter((item) => item.id !== temporaryId && item.id !== serverGroup.id)]),
    activeGroup: serverGroup,
  };
}

export function restoreOptimisticGroups(snapshot: OptimisticSnapshot): OptimisticSnapshot {
  return snapshot;
}

export function applyOptimisticUpdateGroup(
  groups: GroupSummary[],
  activeGroup: GroupSummary | null,
  patch: Pick<GroupSummary, "name">,
): OptimisticSnapshot {
  const updatedGroups = groups.map((group) => (group.id === activeGroup?.id ? { ...group, ...patch } : group));
  return {
    groups: updatedGroups,
    activeGroup: activeGroup ? { ...activeGroup, ...patch } : activeGroup,
  };
}

export function applyOptimisticRemoveGroup(groups: GroupSummary[], groupId: string): OptimisticSnapshot {
  const nextGroups = groups.filter((group) => group.id !== groupId);
  return {
    groups: nextGroups,
    activeGroup: nextGroups[0] ?? null,
  };
}

export function createSeedGroupDetail({
  group,
  ownerMember,
}: {
  group: GroupSummary;
  ownerMember: GroupMemberSummary;
}): GroupDetail {
  return {
    group,
    members: [ownerMember],
    expenses: [],
    balances: [],
  };
}
