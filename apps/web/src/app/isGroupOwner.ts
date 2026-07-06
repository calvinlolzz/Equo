import type { Member } from "./appTypes";

/**
 * Group management (rename/cover, archive, unarchive, delete - and
 * restoring an archived group) is owner-only by product decision. Every
 * other action (invites, member management, expenses, settlements) stays
 * open to all active members.
 *
 * This mirrors the backend's requireGroupOwner check in
 * server/handlers/groups.ts, which treats `role === "owner"` on the
 * caller's own active member row as authoritative. Keeping the frontend
 * gate on the same field means a member row that already came back from
 * the API (via resolveCurrentMember, or an archived-group summary) is
 * enough to decide - no extra request needed just to draw the UI.
 */
export function isGroupOwner(member: Pick<Member, "role"> | null | undefined): boolean {
  return member?.role === "owner";
}
