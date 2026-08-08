/** A 循環支出 rule as the RPCs return it (snake_case, passed through to the client). */
export type RecurringExpenseRecord = {
  id: string;
  group_id: string;
  title: string;
  amount_minor: number;
  currency: string;
  category: string;
  note: string | null;
  payer_member_id: string;
  share_member_ids: string[];
  /** 1-28. 29-31 are refused rather than clamped — see the migration. */
  day_of_month: number;
  next_run_date: string;
  active: boolean;
  /** Why the rule was auto-disabled, e.g. its creator left the group. */
  last_error: string | null;
  last_run_at: string | null;
};

export type RecurringExpenseInput = {
  id?: string;
  title: string;
  amount_minor: number;
  currency?: string;
  category?: string;
  note?: string | null;
  payer_member_id: string;
  share_member_ids: string[];
  day_of_month: number;
  active?: boolean;
};

export type RecurringRepository = {
  /** Null when the caller is not an active member of the group. */
  list(userId: string, groupId: string): Promise<RecurringExpenseRecord[] | null>;
  upsert(userId: string, groupId: string, input: RecurringExpenseInput): Promise<RecurringExpenseRecord>;
  remove(userId: string, groupId: string, id: string): Promise<boolean>;
};
