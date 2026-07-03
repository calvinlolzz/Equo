import { describe, expect, test } from "vitest";
import {
  applyOptimisticCreateGroup,
  applyOptimisticRemoveGroup,
  applyOptimisticUpdateGroup,
  confirmOptimisticCreateGroup,
  createSeedGroupDetail,
  createOptimisticOwnerMember,
  restoreOptimisticGroups,
  type OptimisticSnapshot,
} from "./optimisticGroups";
import type { GroupSummary } from "./apiClient";

const existingGroup: GroupSummary = {
  id: "group_existing",
  name: "Existing",
  currency: "TWD",
  owner_member_id: "member_existing",
};

const serverGroup: GroupSummary = {
  id: "group_server",
  name: "Server Group",
  currency: "TWD",
  owner_member_id: "member_server",
};

describe("optimistic group updates", () => {
  test("adds a temporary group immediately before the server responds", () => {
    const snapshot = applyOptimisticCreateGroup([existingGroup], {
      name: "Instant Group",
      currency: "TWD",
      temporaryId: "optimistic_group_1",
    });

    expect(snapshot.groups).toEqual([
      {
        id: "optimistic_group_1",
        name: "Instant Group",
        currency: "TWD",
        owner_member_id: "optimistic_owner_1",
      },
      existingGroup,
    ]);
    expect(snapshot.activeGroup?.id).toBe("optimistic_group_1");
  });

  test("replaces the temporary group with the server group when sync succeeds", () => {
    const optimistic = applyOptimisticCreateGroup([existingGroup], {
      name: "Instant Group",
      currency: "TWD",
      temporaryId: "optimistic_group_1",
    });
    expect(optimistic.activeGroup).not.toBeNull();

    const confirmed = confirmOptimisticCreateGroup(optimistic.groups, optimistic.activeGroup!.id, serverGroup);

    expect(confirmed.groups).toEqual([serverGroup, existingGroup]);
    expect(confirmed.activeGroup).toEqual(serverGroup);
  });

  test("restores the previous group list when sync fails", () => {
    const snapshot: OptimisticSnapshot = {
      groups: [existingGroup],
      activeGroup: existingGroup,
    };

    expect(restoreOptimisticGroups(snapshot)).toEqual(snapshot);
  });

  test("updates a group name immediately before the server responds", () => {
    const updated = applyOptimisticUpdateGroup([existingGroup], existingGroup, {
      name: "Renamed",
    });

    expect(updated.groups[0]).toEqual({ ...existingGroup, name: "Renamed" });
    expect(updated.activeGroup).toEqual({ ...existingGroup, name: "Renamed" });
  });

  test("removes the active group immediately for archive or delete actions", () => {
    const removed = applyOptimisticRemoveGroup([existingGroup], existingGroup.id);

    expect(removed.groups).toEqual([]);
    expect(removed.activeGroup).toBeNull();
  });

  test("builds seed detail from a newly created group and owner member", () => {
    expect(
      createSeedGroupDetail({
        group: serverGroup,
        ownerMember: {
          id: "member_server",
          group_id: "group_server",
          user_id: "user_1",
          display_name: "Owner",
          role: "owner",
          status: "active",
        },
      }),
    ).toEqual({
      group: serverGroup,
      members: [
        {
          id: "member_server",
          group_id: "group_server",
          user_id: "user_1",
          display_name: "Owner",
          role: "owner",
          status: "active",
        },
      ],
      expenses: [],
      balances: [],
    });
  });

  test("builds a temporary owner member for an optimistic group", () => {
    expect(createOptimisticOwnerMember(serverGroup, "Owner")).toEqual({
      id: "member_server",
      group_id: "group_server",
      user_id: "optimistic_user",
      display_name: "Owner",
      role: "owner",
      status: "active",
    });
  });
});
