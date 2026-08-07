import { useCallback, useEffect, useRef, useState } from "react";
import type { SpendBreakdown, SpendPeriodKind } from "./apiClient";

type Fetcher = (
  groupId: string,
  options: { kind?: SpendPeriodKind; key?: string },
) => Promise<SpendBreakdown>;

type Options = {
  fetchSpendBreakdown: Fetcher | null;
  groupId: string | null;
  /** False while the 分析 panel is closed - nothing is fetched until it opens. */
  enabled: boolean;
  describeError: (error: unknown) => string;
};

/**
 * Drives the 分析 period picker: 每年統計 / 每月統計 and which period is
 * selected, plus the request for that selection.
 *
 * The server answers with both the group total and the caller's own share in
 * one payload, so flipping 個人／群組 is pure rendering - only changing the
 * period (or the bucketing) costs a round trip.
 *
 * Switching bucketing clears the selected key rather than translating it: a
 * "2026" key means nothing in month mode, and the server falls back to its
 * newest period for an unknown key, which is the sensible landing spot anyway.
 */
export function useSpendBreakdown({ fetchSpendBreakdown, groupId, enabled, describeError }: Options) {
  const [periodKind, setPeriodKind] = useState<SpendPeriodKind>("year");
  /** null = "whatever the server considers newest"; set once the user picks. */
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<SpendBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a slow earlier response landing on top of a newer one. */
  const requestId = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled || !groupId || !fetchSpendBreakdown) return;

    const token = ++requestId.current;
    setLoading(true);
    setError(null);

    fetchSpendBreakdown(groupId, { kind: periodKind, key: periodKey ?? undefined })
      .then((result) => {
        if (token !== requestId.current) return;
        setBreakdown(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (token !== requestId.current) return;
        setError(describeError(cause));
        setLoading(false);
      });
    // describeError is a stable formatter; re-running on its identity would
    // refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, groupId, fetchSpendBreakdown, periodKind, periodKey, reloadToken]);

  // A closed panel drops its data, so reopening never flashes another group's
  // numbers while the new request is in flight.
  useEffect(() => {
    if (enabled) return;
    requestId.current += 1;
    setBreakdown(null);
    setError(null);
    setLoading(false);
    setPeriodKey(null);
  }, [enabled]);

  const selectPeriodKind = useCallback((kind: SpendPeriodKind) => {
    setPeriodKind(kind);
    setPeriodKey(null);
  }, []);

  const retry = useCallback(() => setReloadToken((value) => value + 1), []);

  return {
    periodKind,
    /** What the server actually resolved to, falling back to the request. */
    periodKey: breakdown?.period_key ?? periodKey,
    breakdown,
    loading,
    error,
    selectPeriodKind,
    selectPeriodKey: setPeriodKey,
    retry,
  };
}
