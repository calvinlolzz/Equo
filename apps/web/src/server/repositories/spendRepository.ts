/** One selectable period in the 分析 page's chip row. */
export type SpendPeriod = {
  key: string;
  total_minor: number;
};

export type SpendCategoryTotal = {
  category: string;
  group_total_minor: number;
  personal_total_minor: number;
};

/**
 * get_spend_breakdown's wire shape (snake_case, passed through to the client
 * as-is like get_group_detail's payload).
 *
 * `period_key` is null only for a group with no spendable expenses at all -
 * there is no period to select. Both totals are then 0 and by_category empty.
 */
export type SpendBreakdownRecord = {
  period_kind: "year" | "month";
  period_key: string | null;
  currency: string;
  periods: SpendPeriod[];
  group_total_minor: number;
  personal_total_minor: number;
  by_category: SpendCategoryTotal[];
};

export type SpendPeriodKind = "year" | "month";

export type SpendRepository = {
  /** Null when the caller is not an active member, or the group is gone. */
  getSpendBreakdown(
    userId: string,
    groupId: string,
    periodKind: SpendPeriodKind,
    periodKey: string | null,
  ): Promise<SpendBreakdownRecord | null>;
};
