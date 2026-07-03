export function getGroupHomeSummary({
  memberCount,
  expenseAmounts,
  nonZeroBalanceCount,
}: {
  memberCount: number;
  expenseAmounts: number[];
  nonZeroBalanceCount: number;
}) {
  return {
    memberCount,
    expenseCount: expenseAmounts.length,
    totalExpenseMinor: expenseAmounts.reduce((sum, amount) => sum + amount, 0),
    hasDebt: nonZeroBalanceCount > 0,
  };
}
