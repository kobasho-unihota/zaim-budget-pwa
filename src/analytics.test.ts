import { describe, expect, it } from "vitest";
import { buildBudgetSummary } from "./analytics";
import type { BudgetItem, Transaction } from "./types";

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
});
