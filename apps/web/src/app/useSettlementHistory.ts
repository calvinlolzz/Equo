import { useEffect, useState } from "react";
import type { Expense } from "./appTypes";
import { listSettlementRecords, mergeSettlementRecords, type SettlementRecord } from "./settlementHistory";

/** Newest N. A group with more than this has a note under the list saying so. */
const HISTORY_LIMIT = 50;

type Searcher = (search: {
  kind?: string;
  limit?: number;
}) => Promise<{ expenses: Expense[]; matchCount: number }>;

type Options = {
  /** Bound to the active group; null before one is open. */
  searchExpenses: Searcher | null;
  /** False while the 分析 panel is closed - this must not fetch in the background. */
  enabled: boolean;
  /** Settlements visible in the loaded expense window, including optimistic ones. */
  localRecords: SettlementRecord[];
};

export type SettlementHistory = {
  records: SettlementRecord[];
  loading: boolean;
  /** Total the server matched, which can exceed records.length. */
  matchCount: number;
  /** The server could not be reached; the list is the local window only. */
  degraded: boolean;
};

/**
 * 清償紀錄, answered by the server over the group's whole history.
 *
 * It used to be a pure derivation over the loaded expense window, which meant
 * any settlement older than ~100 entries silently vanished from the list - the
 * user's reading of that is "I definitely settled up, where did it go".
 *
 * Fetched when the panel opens rather than kept in the store: it is a read
 * nothing else needs, and a snapshot is fine because the merge below covers
 * anything that happens while the panel is open.
 *
 * A failed fetch degrades to the local window instead of showing an error. The
 * old behaviour is the floor here, so being offline costs the old rows, not
 * the whole section.
 */
export function useSettlementHistory({ searchExpenses, enabled, localRecords }: Options): SettlementHistory {
  const [remote, setRemote] = useState<SettlementRecord[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    if (!enabled || !searchExpenses) return;

    let cancelled = false;
    setLoading(true);
    setDegraded(false);

    searchExpenses({ kind: "settlement", limit: HISTORY_LIMIT })
      .then((page) => {
        if (cancelled) return;
        setRemote(listSettlementRecords(page.expenses));
        setMatchCount(page.matchCount);
      })
      .catch(() => {
        if (cancelled) return;
        setRemote([]);
        setMatchCount(0);
        setDegraded(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, searchExpenses]);

  const records = mergeSettlementRecords(localRecords, enabled ? remote : []);

  return {
    records,
    loading,
    // Never report fewer than we are showing: a locally-optimistic row the
    // server has not seen yet still counts.
    matchCount: Math.max(matchCount, records.length),
    degraded,
  };
}
