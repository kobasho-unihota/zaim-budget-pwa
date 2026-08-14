import { AlertTriangle, CheckCircle2, FileUp, ListFilter, RefreshCcw, Search, SlidersHorizontal, Trash2, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { budgetNameFor, buildBudgetSummary, currentMonth, filteredTransactions } from "./analytics";
import { parseZaimCsvFile } from "./csv";
import { clearData, loadState, saveBudgetItems, saveImport, saveSettings } from "./db";
import { defaultBudgetItems } from "./seed";
import { formatDate, formatPercent, yen } from "./format";
import type { AppState, BudgetItem, ImportIssue, TransactionMethod } from "./types";

type Tab = "settlement" | "details" | "budget" | "csv";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "settlement", label: "決算" },
  { id: "details", label: "明細" },
  { id: "budget", label: "予算" },
  { id: "csv", label: "CSV" }
];

const methodLabels: Record<TransactionMethod, string> = {
  payment: "支出",
  income: "収入",
  transfer: "振替",
  balance: "残高"
};

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("zaim-budget-tab") as Tab | null) ?? "settlement");
  const [message, setMessage] = useState<string>("");
  const [issue, setIssue] = useState<ImportIssue | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("all");
  const [budgetId, setBudgetId] = useState("all");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadState().then(setState).catch((error) => setIssue({ message: String(error) }));
  }, []);

  useEffect(() => {
    localStorage.setItem("zaim-budget-tab", tab);
  }, [tab]);

  const summary = useMemo(() => {
    if (!state) return null;
    return buildBudgetSummary(
      state.transactions,
      state.budgetItems,
      currentMonth(state.transactions),
      state.settings.aggregationMode,
      state.settings.monthlyIncomeEstimate
    );
  }, [state]);

  const detailRows = useMemo(() => {
    if (!state) return [];
    return filteredTransactions(state.transactions, state.budgetItems, query, method, budgetId).slice(0, 200);
  }, [budgetId, method, query, state]);

  async function importFile(file: File) {
    setIsImporting(true);
    setIssue(null);
    setMessage("");
    try {
      const parsed = await parseZaimCsvFile(file);
      const next = await saveImport(parsed.transactions, parsed.metadata);
      setState(next);
      setTab("settlement");
      setMessage(`${parsed.metadata.rowCount.toLocaleString("ja-JP")}件を読み込みました。`);
    } catch (error) {
      setIssue(normalizeIssue(error));
    } finally {
      setIsImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function updateBudgetItems(next: BudgetItem[]) {
    await saveBudgetItems(next);
    setState((current) => (current ? { ...current, budgetItems: next } : current));
  }

  async function updateIncomeEstimate(value: number) {
    if (!state) return;
    const settings = { ...state.settings, monthlyIncomeEstimate: value };
    await saveSettings(settings);
    setState({ ...state, settings });
  }

  async function resetBudgets() {
    await updateBudgetItems(defaultBudgetItems);
  }

  async function deleteImportedData() {
    const next = await clearData();
    setState(next);
    setMessage("読み込み済みCSVデータを削除しました。");
  }

  if (!state || !summary) {
    return <main className="app-shell loading">読み込み中...</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Zaim Budget</p>
          <h1>今月の黒字率</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => inputRef.current?.click()} aria-label="CSVを読み込む">
          <FileUp size={22} />
        </button>
      </header>

      <input
        ref={inputRef}
        className="file-input"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />

      {message && <div className="notice success">{message}</div>}
      {issue && (
        <div className="notice danger">
          {issue.row ? `${issue.row}行目 ` : ""}
          {issue.column ? `${issue.column}: ` : ""}
          {issue.message}
        </div>
      )}

      <nav className="tabs" aria-label="主要画面">
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "settlement" && (
        <SettlementScreen
          summary={summary}
          hasData={state.transactions.length > 0}
          isImporting={isImporting}
          onImport={() => inputRef.current?.click()}
        />
      )}
      {tab === "details" && (
        <DetailsScreen
          rows={detailRows}
          state={state}
          query={query}
          method={method}
          budgetId={budgetId}
          setQuery={setQuery}
          setMethod={setMethod}
          setBudgetId={setBudgetId}
        />
      )}
      {tab === "budget" && (
        <BudgetScreen
          state={state}
          onBudgetChange={updateBudgetItems}
          onIncomeChange={updateIncomeEstimate}
          onReset={resetBudgets}
        />
      )}
      {tab === "csv" && (
        <CsvScreen
          state={state}
          isImporting={isImporting}
          onImport={() => inputRef.current?.click()}
          onDelete={deleteImportedData}
        />
      )}
    </main>
  );
}

function SettlementScreen({
  summary,
  hasData,
  isImporting,
  onImport
}: {
  summary: NonNullable<ReturnType<typeof buildBudgetSummary>>;
  hasData: boolean;
  isImporting: boolean;
  onImport: () => void;
}) {
  const rateClass = summary.projectedSurplusRate >= 0.2 ? "good" : summary.projectedSurplusRate >= 0.1 ? "watch" : "bad";
  return (
    <section className="screen settlement">
      {!hasData ? (
        <div className="empty-state">
          <WalletCards size={42} />
          <h2>CSVを読むと今月の着地が見えます</h2>
          <button className="primary-button" type="button" onClick={onImport} disabled={isImporting}>
            <FileUp size={18} />
            CSVを選択
          </button>
        </div>
      ) : (
        <>
          <section className={`hero-meter ${rateClass}`}>
            <p>{summary.month} 見込み</p>
            <strong>{formatPercent(summary.projectedSurplusRate)}</strong>
            <span>実績 {formatPercent(summary.surplusRate)} / 目標 20%</span>
          </section>

          <p className="guidance">{summary.guidance}</p>

          <div className="metric-grid">
            <Metric label="月末予測差額" value={yen.format(summary.projectedDifference)} tone={summary.projectedDifference >= 0 ? "good" : "bad"} />
            <Metric label="支出実績" value={yen.format(summary.spendingActual)} />
            <Metric label="予算残額" value={yen.format(summary.budgetDifference)} tone={summary.budgetDifference >= 0 ? "good" : "bad"} />
            <Metric label="消化ペース" value={formatPercent(summary.elapsedMonthRatio)} />
          </div>

          <section className="panel">
            <div className="section-title">
              <AlertTriangle size={18} />
              <h2>要改善</h2>
            </div>
            {summary.warningRows.length === 0 ? (
              <div className="quiet-row">
                <CheckCircle2 size={18} />
                予算超過ペースの費目はありません。
              </div>
            ) : (
              <div className="risk-list">
                {summary.warningRows.slice(0, 5).map((row) => (
                  <div className="risk-row" key={row.id}>
                    <div>
                      <strong>{row.name}</strong>
                      <span>{row.classification} / {row.count}回</span>
                    </div>
                    <div className="risk-amount">
                      <b>{yen.format(row.projected)}</b>
                      <span>{yen.format(row.projectedDifference)}</span>
                    </div>
                    <div className="bar" aria-hidden="true">
                      <i style={{ width: `${Math.min(140, row.usageRatio * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function DetailsScreen({
  rows,
  state,
  query,
  method,
  budgetId,
  setQuery,
  setMethod,
  setBudgetId
}: {
  rows: AppState["transactions"];
  state: AppState;
  query: string;
  method: string;
  budgetId: string;
  setQuery: (value: string) => void;
  setMethod: (value: string) => void;
  setBudgetId: (value: string) => void;
}) {
  return (
    <section className="screen">
      <div className="filter-panel">
        <label className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="店・メモ・カテゴリ" />
        </label>
        <div className="select-row">
          <label>
            <ListFilter size={16} />
            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="all">すべて</option>
              <option value="payment">支出</option>
              <option value="income">収入</option>
              <option value="transfer">振替</option>
              <option value="balance">残高</option>
            </select>
          </label>
          <label>
            <SlidersHorizontal size={16} />
            <select value={budgetId} onChange={(event) => setBudgetId(event.target.value)}>
              <option value="all">予算費目</option>
              {state.budgetItems.map((item) => (
                <option value={item.id} key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="transaction-list">
        {rows.map((transaction) => (
          <article className="transaction-row" key={transaction.id}>
            <div>
              <time>{formatDate(transaction.date)}</time>
              <strong>{transaction.shop || transaction.item || transaction.subcategory || transaction.category || methodLabels[transaction.method]}</strong>
              <span>{methodLabels[transaction.method]} / {budgetNameFor(transaction, state.budgetItems)}</span>
              {transaction.memo && <small>{transaction.memo}</small>}
            </div>
            <b className={transaction.method === "income" ? "amount income" : "amount"}>{yen.format(displayAmount(transaction))}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function BudgetScreen({
  state,
  onBudgetChange,
  onIncomeChange,
  onReset
}: {
  state: AppState;
  onBudgetChange: (items: BudgetItem[]) => Promise<void>;
  onIncomeChange: (value: number) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  function updateAmount(id: string, value: number) {
    const next = state.budgetItems.map((item) => (item.id === id ? { ...item, monthlyBudget: Math.max(0, value) } : item));
    void onBudgetChange(next);
  }

  return (
    <section className="screen">
      <section className="panel budget-income">
        <label>
          <span>月収見込み</span>
          <input
            inputMode="numeric"
            type="number"
            min="0"
            step="10000"
            value={state.settings.monthlyIncomeEstimate}
            onChange={(event) => void onIncomeChange(Number(event.target.value))}
          />
        </label>
      </section>
      <div className="budget-list">
        {state.budgetItems.map((item) => (
          <label className="budget-row" key={item.id}>
            <span>
              <strong>{item.name}</strong>
              <small>{item.classification}</small>
            </span>
            <input
              inputMode="numeric"
              type="number"
              min="0"
              step="1000"
              value={item.monthlyBudget}
              onChange={(event) => updateAmount(item.id, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={() => void onReset()}>
        <RefreshCcw size={17} />
        初期値に戻す
      </button>
    </section>
  );
}

function CsvScreen({
  state,
  isImporting,
  onImport,
  onDelete
}: {
  state: AppState;
  isImporting: boolean;
  onImport: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <section className="screen">
      <section className="import-panel">
        <FileUp size={34} />
        <h2>{isImporting ? "読み込み中..." : "Zaim CSVを選択"}</h2>
        <button className="primary-button" type="button" disabled={isImporting} onClick={onImport}>
          CSVを読み込む
        </button>
      </section>
      <section className="panel metadata">
        <Metadata label="CSV" value={state.metadata?.sourceFileName ?? "-"} />
        <Metadata label="件数" value={`${state.metadata?.rowCount.toLocaleString("ja-JP") ?? 0}件`} />
        <Metadata label="期間" value={`${formatDate(state.metadata?.dateStart ?? null)} - ${formatDate(state.metadata?.dateEnd ?? null)}`} />
        <Metadata label="文字コード" value={state.metadata?.encoding ?? "-"} />
      </section>
      <button className="danger-button" type="button" onClick={() => void onDelete()}>
        <Trash2 size={17} />
        読み込みデータを削除
      </button>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function displayAmount(transaction: AppState["transactions"][number]): number {
  switch (transaction.method) {
    case "payment":
      return transaction.expenseAmount;
    case "income":
      return transaction.incomeAmount;
    case "transfer":
      return transaction.transferAmount;
    case "balance":
      return transaction.balanceAdjustmentAmount;
  }
}

function normalizeIssue(error: unknown): ImportIssue {
  if (typeof error === "object" && error && "message" in error) {
    return error as ImportIssue;
  }
  return { message: String(error) };
}
