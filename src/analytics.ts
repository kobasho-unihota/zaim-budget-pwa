import type { AggregationMode, BudgetAnalysisRow, BudgetItem, BudgetStatus, BudgetSummary, Transaction } from "./types";

export function currentMonth(transactions: Transaction[]): Date {
  const latest = transactions.reduce<Date | null>((max, transaction) => {
    const date = new Date(transaction.date);
    return !max || date > max ? date : max;
  }, null);
  return latest ?? new Date();
}

export function buildBudgetSummary(
  transactions: Transaction[],
  budgetItems: BudgetItem[],
  month: Date,
  mode: AggregationMode,
  monthlyIncomeEstimate: number,
  now = new Date()
): BudgetSummary {
  const range = monthRange(month);
  const included = transactions.filter((transaction) => isInRange(transaction.date, range) && shouldInclude(transaction, mode));
  const payments = included.filter((transaction) => transaction.method === "payment");
  const incomeActual = included
    .filter((transaction) => transaction.method === "income")
    .reduce((sum, transaction) => sum + transaction.incomeAmount, 0);
  const elapsedMonthRatio = getElapsedMonthRatio(range, now);

  const rows = budgetItems
    .filter((item) => item.isEnabled)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((item) => {
      const matched = payments.filter((transaction) => matchesBudgetItem(transaction, item));
      const actual = matched.reduce((sum, transaction) => sum + transaction.expenseAmount, 0);
      const projected = elapsedMonthRatio > 0 ? Math.round(actual / elapsedMonthRatio) : actual;
      const usageRatio = item.monthlyBudget === 0 ? 0 : actual / item.monthlyBudget;
      const projectedDifference = item.monthlyBudget - projected;
      return {
        id: item.id,
        classification: item.classification,
        name: item.name,
        detail: item.detail,
        budget: item.monthlyBudget,
        actual,
        count: matched.length,
        usageRatio,
        remaining: item.monthlyBudget - actual,
        projected,
        projectedDifference,
        status: budgetStatus(item.monthlyBudget, actual, usageRatio, elapsedMonthRatio, projected)
      };
    });

  const spendingBudget = rows.reduce((sum, row) => sum + row.budget, 0);
  const spendingActual = rows.reduce((sum, row) => sum + row.actual, 0);
  const projectedSpending = rows.reduce((sum, row) => sum + row.projected, 0);
  const effectiveIncome = incomeActual > 0 ? incomeActual : monthlyIncomeEstimate;
  const surplus = effectiveIncome - spendingActual;
  const projectedSurplus = effectiveIncome - projectedSpending;
  const surplusRate = effectiveIncome === 0 ? 0 : surplus / effectiveIncome;
  const projectedSurplusRate = effectiveIncome === 0 ? 0 : projectedSurplus / effectiveIncome;
  const warningRows = rows
    .filter((row) => row.status !== "clear")
    .sort((a, b) => a.projectedDifference - b.projectedDifference || b.actual - a.actual);

  return {
    month: `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, "0")}`,
    rows,
    incomeActual,
    effectiveIncome,
    spendingBudget,
    spendingActual,
    projectedSpending,
    budgetDifference: spendingBudget - spendingActual,
    projectedDifference: spendingBudget - projectedSpending,
    surplus,
    projectedSurplus,
    surplusRate,
    projectedSurplusRate,
    elapsedMonthRatio,
    warningRows,
    guidance: buildGuidance(projectedSurplusRate, warningRows)
  };
}

export function matchesBudgetItem(transaction: Transaction, budgetItem: BudgetItem): boolean {
  if (transaction.method !== "payment") return false;
  if (transaction.category === budgetItem.classification && transaction.subcategory === budgetItem.name) return true;
  if (transaction.subcategory === budgetItem.name || transaction.category === budgetItem.name) return true;
  const text = [
    transaction.category,
    transaction.subcategory,
    transaction.fromAccount,
    transaction.toAccount,
    transaction.item,
    transaction.memo,
    transaction.shop
  ]
    .filter(Boolean)
    .join(" ");
  return budgetItem.name.length > 0 && text.includes(budgetItem.name);
}

export function filteredTransactions(
  transactions: Transaction[],
  budgetItems: BudgetItem[],
  query: string,
  method: string,
  budgetId: string
): Transaction[] {
  const normalizedQuery = query.trim().toLowerCase();
  return [...transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.sourceRowNumber - a.sourceRowNumber)
    .filter((transaction) => method === "all" || transaction.method === method)
    .filter((transaction) => {
      if (budgetId === "all") return true;
      const item = budgetItems.find((budget) => budget.id === budgetId);
      return item ? matchesBudgetItem(transaction, item) : false;
    })
    .filter((transaction) => {
      if (!normalizedQuery) return true;
      return searchableText(transaction).toLowerCase().includes(normalizedQuery);
    });
}

export function budgetNameFor(transaction: Transaction, budgetItems: BudgetItem[]): string {
  if (transaction.method !== "payment") return "-";
  return budgetItems.find((item) => matchesBudgetItem(transaction, item))?.name ?? "未紐づけ";
}

export function shouldInclude(transaction: Transaction, mode: AggregationMode): boolean {
  return mode === "allData" || transaction.aggregationSetting === "常に集計に含める";
}

function budgetStatus(budget: number, actual: number, usageRatio: number, elapsedRatio: number, projected: number): BudgetStatus {
  if (budget === 0) return actual === 0 ? "clear" : "watch";
  if (actual > budget) return "over";
  if (usageRatio > Math.max(1, elapsedRatio + 0.2)) return "over";
  if (projected > budget) return "watch";
  return "clear";
}

function buildGuidance(projectedSurplusRate: number, warningRows: BudgetAnalysisRow[]): string {
  const top = warningRows[0];
  if (projectedSurplusRate >= 0.2 && !top) {
    return "黒字率20%を超える見込みです。このペースなら今月はかなり健全です。";
  }
  if (projectedSurplusRate >= 0.2 && top) {
    return `黒字率は20%台を維持できそうです。${top.name}だけ少しペースを落とすと安定します。`;
  }
  if (top) {
    return `黒字率20%を割る見込みです。まず${top.name}をあと${Math.max(0, top.actual - top.budget).toLocaleString("ja-JP")}円分だけ締めるのが効きます。`;
  }
  return "黒字率20%まであと少しです。大きな問題費目はなく、月末までの小さな支出が勝負です。";
}

function searchableText(transaction: Transaction): string {
  return [
    transaction.method,
    transaction.category,
    transaction.subcategory,
    transaction.fromAccount,
    transaction.toAccount,
    transaction.item,
    transaction.memo,
    transaction.shop,
    transaction.currency,
    transaction.aggregationSetting
  ]
    .filter(Boolean)
    .join(" ");
}

function isInRange(dateValue: string, range: { start: Date; end: Date }): boolean {
  const date = new Date(dateValue);
  return date >= range.start && date <= range.end;
}

function monthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function getElapsedMonthRatio(range: { start: Date; end: Date }, now: Date): number {
  if (now < range.start) return 0.01;
  if (now > range.end) return 1;
  const elapsedDays = now.getDate();
  const totalDays = range.end.getDate();
  return Math.min(1, Math.max(0.01, elapsedDays / totalDays));
}
