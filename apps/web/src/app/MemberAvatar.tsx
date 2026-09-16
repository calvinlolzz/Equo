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
  colorIndex,
}: {
  name: string | undefined;
  avatarUrl?: string | null;
  className?: string;
  /**
   * Which of the three --member-N colours this avatar should pick up, via a
   * `data-member-color` attribute a caller's own scoped CSS keys off of -
   * see the group home's member list, where this has to agree with the same
   * index the balance card's proportional bar uses for the same person.
   * Undefined (the default, every other call site) renders no attribute at
   * all, so nothing about the shared `.member-avatar` look changes anywhere
   * else.
   */
  colorIndex?: 1 | 2 | 3;
}) {
  if (avatarUrl) {
    return (
      <img
        className={className}
        data-member-color={colorIndex}
        src={upscaleGoogleAvatar(avatarUrl)}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span className={className} data-member-color={colorIndex}>
      {initial(name)}
    </span>
  );
}

/**
 * Google profile picture URLs arrive with a =s96-c suffix (96px square).
 * 96px looks soft on high-DPI screens, so request the 192px variant when
 * the URL is a googleusercontent size-parameterized one; every other URL
 * (our own storage uploads, data URLs) passes through untouched.
 */
export function upscaleGoogleAvatar(url: string): string {
  if (!url.includes("googleusercontent.com")) return url;
  return url.replace(/=s\d+-c$/, "=s192-c");
}

function initial(name: string | undefined) {
  return (name || "?").slice(0, 1).toUpperCase();
}
