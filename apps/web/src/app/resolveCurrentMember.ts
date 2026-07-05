import type { Member } from "./appTypes";

/**
 * Resolve which group Member represents the logged-in user.
 *
 * Bug this fixes: App.tsx used to treat the group's OWNER member as "me" for
 * things like personal-spend totals. That's wrong for any group the current
 * user joined via invite rather than created - they're a non-owner member,
 * so "my spend" rendered the owner's share instead of the viewer's own.
 *
 * The session is always present behind the login wall, so userId is the
 * logged-in user's session.user.id. We match it against each member's
 * userId (set at join/login time - see cloudAdapters.toMembers). If no
 * member matches (e.g. detail hasn't loaded yet, or a data inconsistency),
 * fall back to the owner, then to the first member, same as the old
 * behavior, so callers never get undefined while a group has members.
 */
export function resolveCurrentMember(members: Member[], userId: string | null | undefined): Member | undefined {
  const byUserId = userId ? members.find((member) => member.userId && member.userId === userId) : undefined;
  if (byUserId) return byUserId;

  return members.find((member) => member.role === "owner") ?? members[0];
}
