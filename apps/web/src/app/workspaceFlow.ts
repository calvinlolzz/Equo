export type WorkspaceStepId = "invite" | "expense" | "settle";

export const WORKSPACE_STEPS: Array<{
  id: WorkspaceStepId;
  label: string;
  shortLabel: string;
}> = [
  { id: "invite", label: "邀請成員", shortLabel: "邀請" },
  { id: "expense", label: "新增支出", shortLabel: "支出" },
  { id: "settle", label: "計算結算", shortLabel: "結算" },
];

export function getRecommendedWorkspaceStep({
  memberCount,
  expenseCount,
}: {
  memberCount: number;
  expenseCount: number;
}): WorkspaceStepId {
  if (memberCount < 2) return "invite";
  if (expenseCount === 0) return "expense";
  return "settle";
}
