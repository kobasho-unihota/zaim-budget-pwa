import { describe, expect, it } from "vitest";
import { budgetItemsForMonth, buildBudgetSummary, buildMonthlySummaries, buildYearlySummaries } from "./analytics";
import type { BudgetItem, BudgetPlanVersion, Transaction } from "./types";

const budget: BudgetItem = {
  id: "ゆとり費-コンビニ・自販機",
  classification: "ゆとり費",
  name: "コンビニ・自販機",
  detail: "節約目標",
  monthlyBudget: 10000,
  displayOrder: 0,
  isEnabled: true
};

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    fingerprint: crypto.randomUUID(),
    date: "2026-08-10T00:00:00.000Z",
    method: "payment",
    category: "ゆとり費",
    subcategory: "コンビニ・自販機",
    fromAccount: null,
    toAccount: null,
    item: null,
    memo: null,
    shop: "セブンイレブン",
    currency: "JPY",
    incomeAmount: 0,
    expenseAmount: 0,
    transferAmount: 0,
    balanceAdjustmentAmount: 0,
    originalAmount: 0,
    aggregationSetting: "常に集計に含める",
    sourceRowNumber: 2,
    importedAt: "2026-08-13T00:00:00.000Z",
    ...overrides
  };
}

describe("budget analysis", () => {
  it("matches subcategory, preserves negative expense, and projects month pace", () => {
    const summary = buildBudgetSummary(
      [
        transaction({ expenseAmount: 6000, originalAmount: 6000 }),
        transaction({ expenseAmount: -1000, originalAmount: -1000 })
      ],
      [budget],
      new Date("2026-08-01T00:00:00"),
      "zaimCompliant",
      500000,
      new Date("2026-08-10T12:00:00")
    );

    expect(summary.rows[0].actual).toBe(5000);
    expect(summary.rows[0].projected).toBe(15500);
    expect(summary.rows[0].status).toBe("watch");
    expect(summary.projectedSurplusRate).toBeGreaterThan(0.9);
  });

  it("excludes transfers, balances, and non-monthly Zaim settings from spending", () => {
    const summary = buildBudgetSummary(
      [
        transaction({ method: "transfer", transferAmount: 50000, aggregationSetting: "集計に含めない" }),
        transaction({ method: "balance", balanceAdjustmentAmount: 3000 }),
        transaction({ expenseAmount: 2000, aggregationSetting: "集計に含めない" }),
        transaction({ expenseAmount: 3000, aggregationSetting: "年の集計にのみ含める" }),
        transaction({ expenseAmount: 4000, aggregationSetting: "常に集計に含める" })
      ],
      [budget],
      new Date("2026-08-01T00:00:00"),
      "zaimCompliant",
      500000,
      new Date("2026-08-31T12:00:00")
    );

    expect(summary.spendingActual).toBe(4000);
  });

  it("matches the new parent category budget items by Zaim category", () => {
    const parentBudget: BudgetItem = {
      id: "親カテゴリ-日用品・猫・その他",
      classification: "親カテゴリ",
      name: "日用品・猫・その他",
      detail: "日用品・猫・交通・医療・美容",
      monthlyBudget: 50000,
      displayOrder: 0,
      isEnabled: true
    };
    const summary = buildBudgetSummary(
      [
        transaction({
          category: "日用品・猫・その他",
          subcategory: "医療費",
          expenseAmount: 12000
        }),
        transaction({
          category: "日用品・猫・その他",
          subcategory: "猫関連費",
          expenseAmount: 8000
        })
      ],
      [parentBudget],
      new Date("2026-08-01T00:00:00"),
      "zaimCompliant",
      500000,
      new Date("2026-08-31T12:00:00")
    );

    expect(summary.rows[0].actual).toBe(20000);
    expect(summary.rows[0].name).toBe("日用品・猫・その他");
  });

  it("does not double count parent categories that contain another budget name", () => {
    const householdBudget: BudgetItem = {
      id: "親カテゴリ-日用品・猫・その他",
      classification: "親カテゴリ",
      name: "日用品・猫・その他",
      detail: "日用品・猫・交通・医療・美容",
      monthlyBudget: 50000,
      displayOrder: 0,
      isEnabled: true
    };
    const otherBudget: BudgetItem = {
      id: "親カテゴリ-その他",
      classification: "親カテゴリ",
      name: "その他",
      detail: "未分類",
      monthlyBudget: 0,
      displayOrder: 1,
      isEnabled: true
    };
    const summary = buildBudgetSummary(
      [
        transaction({
          category: "日用品・猫・その他",
          subcategory: "日用品",
          expenseAmount: 30000
        })
      ],
      [householdBudget, otherBudget],
      new Date("2026-08-01T00:00:00"),
      "zaimCompliant",
      500000,
      new Date("2026-08-31T12:00:00")
    );

    expect(summary.spendingActual).toBe(30000);
    expect(summary.rows.find((row) => row.name === "日用品・猫・その他")?.actual).toBe(30000);
    expect(summary.rows.find((row) => row.name === "その他")?.actual).toBe(0);
  });

  it("uses CSV income when present and otherwise falls back to configured income", () => {
    const noIncome = buildBudgetSummary([], [budget], new Date("2026-08-01T00:00:00"), "zaimCompliant", 500000);
    const withIncome = buildBudgetSummary(
      [transaction({ method: "income", incomeAmount: 420000, category: "収入", subcategory: null })],
      [budget],
      new Date("2026-08-01T00:00:00"),
      "zaimCompliant",
      500000
    );

    expect(noIncome.effectiveIncome).toBe(500000);
    expect(withIncome.effectiveIncome).toBe(420000);
  });

  it("does not treat excluded income as monthly income or fallback estimate", () => {
    const summary = buildBudgetSummary(
      [
        transaction({
          method: "income",
          incomeAmount: 420000,
          category: "収入",
          subcategory: null,
          aggregationSetting: "集計に含めない"
        }),
        transaction({ expenseAmount: 20000 })
      ],
      [budget],
      new Date("2026-08-01T00:00:00"),
      "zaimCompliant",
      500000,
      new Date("2026-08-31T12:00:00")
    );

    expect(summary.incomeActual).toBe(0);
    expect(summary.effectiveIncome).toBe(0);
    expect(summary.surplus).toBe(-20000);
  });

  it("builds monthly summaries with previous year comparison", () => {
    const versions: BudgetPlanVersion[] = [
      { id: "2025-08", effectiveMonth: "2025-08", items: [budget], createdAt: "2026-08-15T00:00:00.000Z" }
    ];
    const monthly = buildMonthlySummaries(
      [
        transaction({ date: "2025-08-10T00:00:00.000Z", expenseAmount: 8000 }),
        transaction({ date: "2026-08-10T00:00:00.000Z", expenseAmount: 6000 }),
        transaction({ date: "2026-08-11T00:00:00.000Z", method: "transfer", transferAmount: 50000 })
      ],
      versions,
      { monthlyIncomeEstimate: 100000, aggregationMode: "zaimCompliant" },
      new Date("2026-08-31T12:00:00")
    );

    expect(monthly.map((summary) => summary.month)).toEqual(["2025-08", "2026-08"]);
    expect(monthly[1].previousYearSpendingDelta).toBe(-2000);
    expect(monthly[1].previousYearSurplusDelta).toBe(2000);
    expect(monthly[1].spendingActual).toBe(6000);
    expect(monthly[1].incomeWasEstimated).toBe(true);
  });

  it("switches budget items by effective month", () => {
    const oldBudget = { ...budget, monthlyBudget: 5000 };
    const newBudget = { ...budget, monthlyBudget: 15000 };
    const versions: BudgetPlanVersion[] = [
      { id: "2025-01", effectiveMonth: "2025-01", items: [oldBudget], createdAt: "2026-08-15T00:00:00.000Z" },
      { id: "2026-08", effectiveMonth: "2026-08", items: [newBudget], createdAt: "2026-08-15T00:00:00.000Z" }
    ];

    expect(budgetItemsForMonth(versions, "2026-07")[0].monthlyBudget).toBe(5000);
    expect(budgetItemsForMonth(versions, "2026-08")[0].monthlyBudget).toBe(15000);
  });

  it("builds yearly summaries with category totals", () => {
    const transactions = [
      transaction({ date: "2026-08-10T00:00:00.000Z", expenseAmount: 6000 }),
      transaction({ date: "2026-09-10T00:00:00.000Z", expenseAmount: 4000 }),
      transaction({ date: "2026-09-11T00:00:00.000Z", method: "income", incomeAmount: 200000, category: "収入", subcategory: null })
    ];
    const versions: BudgetPlanVersion[] = [
      { id: "2026-08", effectiveMonth: "2026-08", items: [budget], createdAt: "2026-08-15T00:00:00.000Z" }
    ];
    const monthly = buildMonthlySummaries(transactions, versions, { monthlyIncomeEstimate: 100000, aggregationMode: "zaimCompliant" });
    const yearly = buildYearlySummaries(transactions, monthly, [budget], "zaimCompliant");

    expect(yearly[0].year).toBe("2026");
    expect(yearly[0].monthCount).toBe(2);
    expect(yearly[0].spendingActual).toBe(10000);
    expect(yearly[0].effectiveIncome).toBe(200000);
    expect(yearly[0].surplus).toBe(190000);
    expect(yearly[0].surplusRate).toBe(0.95);
    expect(yearly[0].categoryTotals[0].name).toBe("コンビニ・自販機");
  });

  it("includes year-only Zaim settings in yearly summaries only", () => {
    const transactions = [
      transaction({ date: "2026-08-10T00:00:00.000Z", expenseAmount: 6000 }),
      transaction({ date: "2026-08-11T00:00:00.000Z", expenseAmount: 3000, aggregationSetting: "年の集計にのみ含める" }),
      transaction({ date: "2026-08-12T00:00:00.000Z", expenseAmount: 2000, aggregationSetting: "集計に含めない" }),
      transaction({ date: "2026-08-13T00:00:00.000Z", method: "income", incomeAmount: 100000, category: "収入", subcategory: null }),
      transaction({ date: "2026-08-14T00:00:00.000Z", method: "income", incomeAmount: 50000, category: "収入", subcategory: null, aggregationSetting: "年の集計にのみ含める" }),
      transaction({ date: "2026-08-15T00:00:00.000Z", method: "transfer", transferAmount: 70000, aggregationSetting: "年の集計にのみ含める" }),
      transaction({ date: "2026-08-16T00:00:00.000Z", method: "balance", balanceAdjustmentAmount: 9000, aggregationSetting: "年の集計にのみ含める" })
    ];
    const versions: BudgetPlanVersion[] = [
      { id: "2026-08", effectiveMonth: "2026-08", items: [budget], createdAt: "2026-08-15T00:00:00.000Z" }
    ];
    const monthly = buildMonthlySummaries(transactions, versions, { monthlyIncomeEstimate: 100000, aggregationMode: "zaimCompliant" });
    const yearly = buildYearlySummaries(transactions, monthly, [budget], "zaimCompliant");

    expect(monthly[0].spendingActual).toBe(6000);
    expect(monthly[0].incomeActual).toBe(100000);
    expect(yearly[0].spendingActual).toBe(9000);
    expect(yearly[0].incomeActual).toBe(150000);
    expect(yearly[0].surplus).toBe(141000);
  });
});
