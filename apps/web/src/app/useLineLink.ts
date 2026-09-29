import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "./apiClient";

export type LineLinkState = "loading" | "linked" | "unlinked" | "hidden";

/**
 * Whether this account has a LINE account linked, for the profile page's
 * account tab.
 *
 * Fetches only while `active` (the account tab being on screen) - the same
 * shape as usePushNotifications: opening this dialog is not worth a round
 * trip for a row most people never look at. A failed fetch sets "hidden"
 * rather than surfacing an error - LINE bookkeeping is a nice-to-have, and a
 * row that silently disappears on a flaky connection is better than one that
 * shows an error banner for a feature the person may not even use.
 */
export function useLineLink(active: boolean) {
  const [state, setState] = useState<LineLinkState>("loading");
  const [linkedAt, setLinkedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    createApiClient()
      .getMyLineLink()
      .then((result) => {
        if (cancelled) return;
        setState(result.linked ? "linked" : "unlinked");
        setLinkedAt(result.linked_at);
      })
      .catch(() => {
        if (!cancelled) setState("hidden");
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  const unlink = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await createApiClient().unlinkMyLine();
      setState("unlinked");
      setLinkedAt(null);
      return result.unlinked;
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, linkedAt, busy, unlink };
}
