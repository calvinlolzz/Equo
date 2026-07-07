/**
 * Decides where the root URL ("/") should land a logged-in user: their
 * most-recent group, or nowhere (the create-first-group start flow) when
 * they have none. cloudGroups is ordered newest-first (updated_at desc), so
 * the newest group is simply the head of the list.
 */
export function resolveRootLanding(groups: Array<{ id: string }>): string | null {
  return groups[0]?.id ?? null;
}
