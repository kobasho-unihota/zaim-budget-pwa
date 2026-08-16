import type {
  AggregationMode,
  AppSettings,
  BudgetAnalysisRow,
  BudgetItem,
  BudgetPlanVersion,
  BudgetStatus,
  BudgetSummary,
  MonthlySummary,
  Transaction,
  YearlyCategoryTotal,
  YearlySummary
} from "./types";

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
  now = new Date(),
  useProjection = true
): BudgetSummary {
  const range = monthRange(month);
  const included = transactions.filter((transaction) => isInRange(transaction.date, range) && shouldInclude(transaction, mode));
  const payments = included.filter((transaction) => transaction.method === "payment");
  const incomeActual = included
    .filter((transaction) => transaction.method === "income")
    .reduce((sum, transaction) => sum + transaction.incomeAmount, 0);
  const elapsedMonthRatio = useProjection ? getElapsedMonthRatio(range, now) : 1;

  const rows = budgetItems
    .filter((item) => item.isEnabled)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((item) => {
      const matched = payments.filter((transaction) => budgetNameFor(transaction, budgetItems) === item.name);
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
  const spendingActual = payments.reduce((sum, transaction) => sum + transaction.expenseAmount, 0);
  const projectedSpending = elapsedMonthRatio > 0 ? Math.round(spendingActual / elapsedMonthRatio) : spendingActual;
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
  if (transaction.category === budgetItem.name) return true;
  if (transaction.category === budgetItem.classification && transaction.subcategory === budgetItem.name) return true;
  if (transaction.subcategory === budgetItem.name || transaction.category === budgetItem.name) return true;
  return false;
}

export function filteredTransactions(
  transactions: Transaction[],
  budgetItems: BudgetItem[],
  query: string,
  method: string,
  budgetId: string,
  period: { type: "all" | "year" | "month"; value: string }
): Transaction[] {
  const normalizedQuery = query.trim().toLowerCase();
  return [...transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.sourceRowNumber - a.sourceRowNumber)
    .filter((transaction) => matchesPeriod(transaction, period))
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

export function buildMonthlySummaries(
  transactions: Transaction[],
  budgetPlanVersions: BudgetPlanVersion[],
  settings: AppSettings,
  now = new Date()
): MonthlySummary[] {
  const monthKeys = Array.from(new Set(transactions.map((transaction) => toMonthKey(transaction.date)))).sort();
  const summaries = monthKeys.map((month) => {
    const monthDate = monthStart(month);
    const budgetItems = budgetItemsForMonth(budgetPlanVersions, month);
    const useProjection = month === toMonthKey(now.toISOString());
    const summary = buildBudgetSummary(
      transactions,
      budgetItems,
      monthDate,
      settings.aggregationMode,
      settings.monthlyIncomeEstimate,
      now,
      useProjection
    );
    return {
      id: month,
      month,
      year: month.slice(0, 4),
      label: `${Number(month.slice(5, 7))}月`,
      spendingActual: summary.spendingActual,
      incomeActual: summary.incomeActual,
      effectiveIncome: summary.effectiveIncome,
      incomeWasEstimated: summary.incomeActual === 0 && summary.effectiveIncome > 0,
      spendingBudget: summary.spendingBudget,
      budgetDifference: summary.budgetDifference,
      surplus: summary.surplus,
      surplusRate: summary.surplusRate,
      previousYearSpendingDelta: null,
      previousYearSurplusDelta: null,
      previousYearSurplusRateDelta: null
    };
  });
  const byMonth = new Map(summaries.map((summary) => [summary.month, summary]));
  return summaries.map((summary) => {
    const previous = byMonth.get(previousYearMonth(summary.month));
    return {
      ...summary,
      previousYearSpendingDelta: previous ? summary.spendingActual - previous.spendingActual : null,
      previousYearSurplusDelta: previous ? summary.surplus - previous.surplus : null,
      previousYearSurplusRateDelta: previous ? summary.surplusRate - previous.surplusRate : null
    };
  });
}

export function buildYearlySummaries(
  transactions: Transaction[],
  monthlySummaries: MonthlySummary[],
  budgetItems: BudgetItem[],
  mode: AggregationMode
): YearlySummary[] {
  const years = Array.from(new Set(transactions.map((transaction) => toMonthKey(transaction.date).slice(0, 4)))).sort((a, b) => b.localeCompare(a));
  const monthsByYear = new Map<string, Set<string>>();
  monthlySummaries.forEach((summary) => {
    const months = monthsByYear.get(summary.year) ?? new Set<string>();
    months.add(summary.month);
    monthsByYear.set(summary.year, months);
  });

  return years
    .map((year) => {
      const included = transactions.filter((transaction) => {
        return toMonthKey(transaction.date).startsWith(year) && shouldIncludeInYearlySummary(transaction, mode);
      });
      const yearPayments = included.filter((transaction) => transaction.method === "payment");
      const categoryTotals = yearlyCategoryTotals(yearPayments, budgetItems);
      const spendingActual = yearPayments.reduce((sum, transaction) => sum + transaction.expenseAmount, 0);
      const incomeActual = included
        .filter((transaction) => transaction.method === "income")
        .reduce((sum, transaction) => sum + transaction.incomeAmount, 0);
      const effectiveIncome = incomeActual;
      const spendingBudget = 0;
      const surplus = effectiveIncome - spendingActual;
      const monthCount = monthsByYear.get(year)?.size ?? 0;
      return {
        id: year,
        year,
        monthCount,
        spendingActual,
        incomeActual,
        effectiveIncome,
        spendingBudget,
        budgetDifference: spendingBudget - spendingActual,
        surplus,
        surplusRate: effectiveIncome === 0 ? 0 : surplus / effectiveIncome,
        monthlyAverageSpending: monthCount === 0 ? 0 : Math.round(spendingActual / monthCount),
        categoryTotals
      };
    });
}

export function budgetItemsForMonth(versions: BudgetPlanVersion[], month: string): BudgetItem[] {
  const sorted = [...versions].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  const matched = sorted.filter((version) => version.effectiveMonth <= month).at(-1) ?? sorted[0];
  return matched?.items ?? [];
}

export function monthOptions(transactions: Transaction[]): string[] {
  return Array.from(new Set(transactions.map((transaction) => toMonthKey(transaction.date)))).sort().reverse();
}

export function yearOptions(transactions: Transaction[]): string[] {
  return Array.from(new Set(transactions.map((transaction) => toMonthKey(transaction.date).slice(0, 4)))).sort().reverse();
}

export function toMonthKey(dateValue: string): string {
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function budgetNameFor(transaction: Transaction, budgetItems: BudgetItem[]): string {
  if (transaction.method !== "payment") return "-";
  return budgetItems.find((item) => matchesBudgetItem(transaction, item))?.name ?? "未紐づけ";
}

export function shouldInclude(transaction: Transaction, mode: AggregationMode): boolean {
  return mode === "allData" || transaction.aggregationSetting === "常に集計に含める";
}

export function shouldIncludeInYearlySummary(transaction: Transaction, mode: AggregationMode): boolean {
  return mode === "allData" || transaction.aggregationSetting === "常に集計に含める" || transaction.aggregationSetting === "年の集計にのみ含める";
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
    return "貯蓄率20%を超える見込みです。このペースなら今月はかなり健全です。";
  }
  if (projectedSurplusRate >= 0.2 && top) {
    return `貯蓄率は20%以上を維持できそうです。${top.name}だけ少しペースを落とすと安定します。`;
  }
  if (top) {
    return `貯蓄率20%を割る見込みです。まず${top.name}をあと${Math.max(0, top.actual - top.budget).toLocaleString("ja-JP")}円分だけ締めるのが効きます。`;
  }
  return "貯蓄率20%まであと少しです。大きな問題費目はなく、月末までの小さな支出が勝負です。";
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

function matchesPeriod(transaction: Transaction, period: { type: "all" | "year" | "month"; value: string }): boolean {
  if (period.type === "all") return true;
  const month = toMonthKey(transaction.date);
  return period.type === "month" ? month === period.value : month.startsWith(period.value);
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

function monthStart(month: string): Date {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
}

function previousYearMonth(month: string): string {
  return `${Number(month.slice(0, 4)) - 1}-${month.slice(5, 7)}`;
}

function yearlyCategoryTotals(transactions: Transaction[], budgetItems: BudgetItem[]): YearlyCategoryTotal[] {
  const totals = new Map<string, YearlyCategoryTotal>();
  transactions.forEach((transaction) => {
    const name = budgetNameFor(transaction, budgetItems);
    const current = totals.get(name) ?? { id: name, name, amount: 0, count: 0 };
    totals.set(name, {
      ...current,
      amount: current.amount + transaction.expenseAmount,
      count: current.count + 1
    });
  });
  return Array.from(totals.values()).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}
