import { isPersonalGroup } from "./personalLedger";

/**
 * Decides where the root URL ("/") should land a logged-in user: their
 * most-recent SHARED group, or the personal ledger when that's all they
 * have, or nowhere (the create-first-group start flow) when they have
 * neither. cloudGroups is ordered newest-first (updated_at desc), so the
 * newest shared group is simply the first non-personal entry.
 *
 * Landing on a shared group over the ledger (when both exist) keeps
 * existing users on the screen they already know - the ledger is created
 * lazily on first list fetch (see ensure_personal_ledger), so an existing
 * user's very next login gains one without their landing screen changing.
 * A brand-new user has only the ledger, so they land there instead of the
 * empty create-first-group flow - see the plan's §4b.
 */
export function resolveRootLanding(groups: Array<{ id: string; kind?: string }>): string | null {
  return groups.find((group) => !isPersonalGroup(group))?.id ?? groups[0]?.id ?? null;
}
