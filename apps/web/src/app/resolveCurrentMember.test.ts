import { describe, expect, test } from "vitest";
import type { Member } from "./appTypes";
import { resolveCurrentMember } from "./resolveCurrentMember";

describe("resolveCurrentMember", () => {
  test("joined-group case: returns the non-owner member whose userId matches the session user", () => {
    const members: Member[] = [
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "owner_user" },
      { id: "member_2", name: "Bob", role: "member", virtual: false, userId: "me_user" },
    ];

    expect(resolveCurrentMember(members, "me_user")).toEqual(members[1]);
  });

  test("owner case: returns the owner when their userId matches the session user", () => {
    const members: Member[] = [
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "owner_user" },
      { id: "member_2", name: "Bob", role: "member", virtual: false, userId: "me_user" },
    ];

    expect(resolveCurrentMember(members, "owner_user")).toEqual(members[0]);
  });

  test("fallback case: no member's userId matches, falls back to the owner", () => {
    const members: Member[] = [
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "owner_user" },
      { id: "member_2", name: "Bob", role: "member", virtual: false, userId: "someone_else" },
    ];

    expect(resolveCurrentMember(members, "unmatched_user")).toEqual(members[0]);
  });

  test("fallback case: no owner present, falls back to the first member", () => {
    const members: Member[] = [
      { id: "member_1", name: "Alice", role: "member", virtual: false, userId: "someone_else" },
      { id: "member_2", name: "Bob", role: "member", virtual: false, userId: "another_user" },
    ];

    expect(resolveCurrentMember(members, "unmatched_user")).toEqual(members[0]);
  });

  test("fallback case: undefined/null userId (no session-matching possible) falls back to owner", () => {
    const members: Member[] = [
      { id: "member_1", name: "Alice", role: "member", virtual: false, userId: "some_user" },
      { id: "member_2", name: "Bob", role: "owner", virtual: false, userId: "another_user" },
    ];

    expect(resolveCurrentMember(members, undefined)).toEqual(members[1]);
    expect(resolveCurrentMember(members, null)).toEqual(members[1]);
  });

  test("virtual members (userId null) are never matched as the current user", () => {
    const members: Member[] = [
      { id: "member_1", name: "Cash Tab", role: "member", virtual: true, userId: null },
      { id: "member_2", name: "Alice", role: "owner", virtual: false, userId: "owner_user" },
    ];

    expect(resolveCurrentMember(members, null)).toEqual(members[1]);
  });

  test("empty members list returns undefined", () => {
    expect(resolveCurrentMember([], "me_user")).toBeUndefined();
  });
});
