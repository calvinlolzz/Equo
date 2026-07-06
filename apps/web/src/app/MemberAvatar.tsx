/**
 * Shared avatar renderer for anywhere a member appears (hero stack, balance
 * rows, member list, composer payer/share rows, expense detail, records
 * rows, settlement suggestions, debt cards). Renders the member's real photo
 * (their Google profile picture by default, or a custom upload once they set
 * one - see updateMyAvatar/App.tsx's saveProfile) when avatarUrl is present;
 * otherwise falls back to the existing initial-letter style so virtual
 * members (who never have an avatarUrl) keep looking exactly as before.
 *
 * className is passed straight through so every call site keeps its exact
 * existing sizing/shape classes (e.g. "member-avatar", "member-avatar lime",
 * "hero-avatar") - this component only decides img-vs-initial, never layout.
 */
export function MemberAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string | undefined;
  avatarUrl?: string | null;
  className?: string;
}) {
  if (avatarUrl) {
    return <img className={className} src={avatarUrl} alt="" />;
  }

  return <span className={className}>{initial(name)}</span>;
}

function initial(name: string | undefined) {
  return (name || "?").slice(0, 1).toUpperCase();
}
