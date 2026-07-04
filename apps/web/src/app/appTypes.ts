export type Group = {
  id: string;
  name: string;
  currency: string;
  coverImageUrl?: string;
};

export type Member = {
  id: string;
  name: string;
  role?: "owner" | "member";
  virtual?: boolean;
};

export type Expense = {
  id: string;
  title: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  payerId: string;
  shareMemberIds: string[];
  kind?: "expense" | "settlement";
  category?: string;
  note?: string;
  imageUrl?: string;
  sourceCurrency?: string;
  sourceAmountMinor?: number;
  exchangeRate?: number;
  shareAmountsMinor?: Record<string, number>;
};

export type Activity = {
  id: string;
  text: string;
  createdAt: string;
};

export type GroupData = {
  members: Member[];
  expenses: Expense[];
  activities: Activity[];
};

export type ArchivedGroup = Group & {
  archivedAt: string;
};

export type StartMode = "create" | "join" | "continue";
