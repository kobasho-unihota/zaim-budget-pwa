export type TransactionMethod = "payment" | "income" | "transfer" | "balance";
export type AggregationSetting = "常に集計に含める" | "集計に含めない" | "年の集計にのみ含める";
export type AggregationMode = "zaimCompliant" | "allData";
export type BudgetStatus = "clear" | "watch" | "over";

export interface Transaction {
  id: string;
  fingerprint: string;
  date: string;
  method: TransactionMethod;
  category: string | null;
  subcategory: string | null;
  fromAccount: string | null;
  toAccount: string | null;
  item: string | null;
  memo: string | null;
  shop: string | null;
  currency: string;
  incomeAmount: number;
  expenseAmount: number;
  transferAmount: number;
  balanceAdjustmentAmount: number;
  originalAmount: number;
  aggregationSetting: AggregationSetting;
  sourceRowNumber: number;
  importedAt: string;
}

export interface ImportMetadata {
  sourceFileName: string;
  importedAt: string;
  rowCount: number;
  dateStart: string | null;
  dateEnd: string | null;
  monthCount: number;
  yearCount: number;
  encoding: "Shift_JIS" | "UTF-8";
  csvHeaderSignature: string;
}

export interface BudgetItem {
  id: string;
  classification: string;
  name: string;
  detail: string;
  monthlyBudget: number;
  displayOrder: number;
  isEnabled: boolean;
}

export interface AppSettings {
  monthlyIncomeEstimate: number;
  aggregationMode: AggregationMode;
}

export interface BudgetPlanVersion {
  id: string;
  effectiveMonth: string;
  items: BudgetItem[];
  createdAt: string;
}

export interface AppState {
  transactions: Transaction[];
  metadata: ImportMetadata | null;
  budgetItems: BudgetItem[];
  budgetPlanVersions: BudgetPlanVersion[];
  settings: AppSettings;
}

export interface ImportIssue {
  row?: number;
  column?: string;
  message: string;
}

export interface ParsedImport {
  transactions: Transaction[];
  metadata: ImportMetadata;
}

export interface BudgetAnalysisRow {
  id: string;
  classification: string;
  name: string;
  detail: string;
  budget: number;
  actual: number;
  count: number;
  usageRatio: number;
  remaining: number;
  projected: number;
  projectedDifference: number;
  status: BudgetStatus;
}

export interface BudgetSummary {
  month: string;
  rows: BudgetAnalysisRow[];
  incomeActual: number;
  effectiveIncome: number;
  spendingBudget: number;
  spendingActual: number;
  projectedSpending: number;
  budgetDifference: number;
  projectedDifference: number;
  surplus: number;
  projectedSurplus: number;
  surplusRate: number;
  projectedSurplusRate: number;
  elapsedMonthRatio: number;
  warningRows: BudgetAnalysisRow[];
  guidance: string;
}

export interface MonthlySummary {
  id: string;
  month: string;
  year: string;
  label: string;
  spendingActual: number;
  incomeActual: number;
  effectiveIncome: number;
  incomeWasEstimated: boolean;
  spendingBudget: number;
  budgetDifference: number;
  surplus: number;
  surplusRate: number;
  previousYearSpendingDelta: number | null;
  previousYearSurplusDelta: number | null;
  previousYearSurplusRateDelta: number | null;
}

export interface YearlyCategoryTotal {
  id: string;
  name: string;
  amount: number;
  count: number;
}

export interface YearlySummary {
  id: string;
  year: string;
  monthCount: number;
  spendingActual: number;
  incomeActual: number;
  effectiveIncome: number;
  spendingBudget: number;
  budgetDifference: number;
  surplus: number;
  surplusRate: number;
  monthlyAverageSpending: number;
  categoryTotals: YearlyCategoryTotal[];
}
