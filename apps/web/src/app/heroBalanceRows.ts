import type { Member } from "./appTypes";

/**
 * Which members the home card's balance list shows.
 *
 * It used to be `members.slice(0, 2)` — the first two entries of the array,
 * which is creation order and nothing else. In a group of six that is two
 * arbitrary people's balances presented as if they were a summary, and the one
 * balance everybody actually opens the app for — their own — was only there by
 * luck.
 *
 * So: you first, then whoever is furthest from settled. Absolute value, because
 * "owed 8,000" and "owes 8,000" are equally worth knowing about, and ties keep
 * the group's own order so the row does not shuffle between renders.
 */
export function heroBalanceMembers(
  members: Member[],
  balances: Map<string, number>,
  currentMemberId: string | undefined,
  limit = 2,
): Member[] {
  const byImbalance = (candidates: Member[]) =>
    candidates
      .map((member, index) => ({ member, index }))
      .sort((a, b) => {
        const gap = Math.abs(balances.get(b.member.id) ?? 0) - Math.abs(balances.get(a.member.id) ?? 0);
        return gap !== 0 ? gap : a.index - b.index;
      })
      .map((entry) => entry.member);

  const self = members.find((member) => member.id === currentMemberId);
  // No self to pin (a viewer the group has no member for): fall back to the
  // list this is otherwise ranking by, rather than to array order.
  if (!self) return byImbalance(members).slice(0, limit);

  return [self, ...byImbalance(members.filter((member) => member.id !== self.id))].slice(0, limit);
}
