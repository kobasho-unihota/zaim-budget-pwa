import { AlertTriangle, BarChart3, CheckCircle2, Database, FileUp, ListFilter, ReceiptText, RefreshCcw, Search, SlidersHorizontal, Trash2, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  budgetItemsForMonth,
  budgetNameFor,
  buildBudgetSummary,
  buildMonthlySummaries,
  buildYearlySummaries,
  currentMonth,
  filteredTransactions,
  monthOptions,
  toMonthKey,
  yearOptions
} from "./analytics";
import { parseZaimCsvFile } from "./csv";
import { clearData, loadState, saveBudgetItems, saveBudgetPlanVersion, saveImport, saveSettings } from "./db";
import { defaultBudgetItems } from "./seed";
import { formatDate, formatPercent, yen } from "./format";
import type { AppState, BudgetItem, ImportIssue, MonthlySummary, TransactionMethod, YearlySummary } from "./types";

type Tab = "settlement" | "analysis" | "details" | "budget" | "csv";
type PeriodFilter = { type: "all" | "year" | "month"; value: string };
type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "default" | "danger";
  onConfirm: () => void;
  onCancel?: () => void;
};

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "settlement", label: "決算", icon: WalletCards },
  { id: "analysis", label: "分析", icon: BarChart3 },
  { id: "details", label: "明細", icon: ReceiptText },
  { id: "budget", label: "予算", icon: SlidersHorizontal },
  { id: "csv", label: "CSV", icon: Database }
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
  const [selectedMonth, setSelectedMonth] = useState("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>({ type: "all", value: "" });
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadState()
      .then((next) => {
        setState(next);
        setSelectedMonth(toMonthKey(currentMonth(next.transactions).toISOString()));
      })
      .catch((error) => setIssue({ message: String(error) }));
  }, []);

  useEffect(() => {
    localStorage.setItem("zaim-budget-tab", tab);
  }, [tab]);

  const availableMonths = useMemo(() => (state ? monthOptions(state.transactions) : []), [state]);
  const latestMonth = availableMonths[0] ?? "";

  const summary = useMemo(() => {
    if (!state) return null;
    const month = selectedMonth || toMonthKey(currentMonth(state.transactions).toISOString());
    return buildBudgetSummary(
      state.transactions,
      budgetItemsForMonth(state.budgetPlanVersions, month),
      new Date(`${month}-01T00:00:00`),
      state.settings.aggregationMode,
      state.settings.monthlyIncomeEstimate,
      new Date(),
      month === latestMonth
    );
  }, [latestMonth, selectedMonth, state]);

  const monthlySummaries = useMemo(() => {
    if (!state) return [];
    return buildMonthlySummaries(state.transactions, state.budgetPlanVersions, state.settings);
  }, [state]);

  const yearlySummaries = useMemo(() => {
    if (!state) return [];
    return buildYearlySummaries(state.transactions, monthlySummaries, state.budgetItems, state.settings.aggregationMode);
  }, [monthlySummaries, state]);

  const detailRows = useMemo(() => {
    if (!state) return [];
    return filteredTransactions(state.transactions, state.budgetItems, query, method, budgetId, periodFilter).slice(0, 300);
  }, [budgetId, method, periodFilter, query, state]);
  const currentTab = tabs.find((item) => item.id === tab) ?? tabs[0];

  async function importFile(file: File, confirmed = false) {
    if (state?.transactions.length && !confirmed) {
      setConfirmRequest({
        title: "CSVを置き換えますか？",
        message: "現在の取込データを削除し、このCSVの内容で全件置き換えます。端末内の家計データは外部送信されません。",
        confirmLabel: "置き換える",
        tone: "default",
        onConfirm: () => void importFile(file, true),
        onCancel: () => {
          if (inputRef.current) inputRef.current.value = "";
        }
      });
      return;
    }
    setIsImporting(true);
    setIssue(null);
    setMessage("");
    try {
      const parsed = await parseZaimCsvFile(file);
      const next = await saveImport(parsed.transactions, parsed.metadata);
      setState(next);
      setSelectedMonth(toMonthKey(currentMonth(next.transactions).toISOString()));
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

  async function updateBudgetPlan(next: BudgetItem[], effectiveMonth: string) {
    const version = {
      id: effectiveMonth,
      effectiveMonth,
      items: next,
      createdAt: new Date().toISOString()
    };
    const nextState = await saveBudgetPlanVersion(version, next);
    setState(nextState);
  }

  async function updateIncomeEstimate(value: number) {
    if (!state) return;
    const settings = { ...state.settings, monthlyIncomeEstimate: value };
    await saveSettings(settings);
    setState({ ...state, settings });
  }

  function resetBudgets() {
    setConfirmRequest({
      title: "予算を初期値に戻しますか？",
      message: "選択中の適用月で、スプレッドシート由来の初期予算に戻します。現在編集中の予算額は上書きされます。",
      confirmLabel: "初期値に戻す",
      tone: "danger",
      onConfirm: () => void updateBudgetPlan(defaultBudgetItems, selectedMonth || toMonthKey(new Date().toISOString()))
    });
  }

  function deleteImportedData() {
    setConfirmRequest({
      title: "取込データを削除しますか？",
      message: "端末内に保存したCSV取込データを削除します。予算設定は残りますが、明細と分析データは再読込が必要です。",
      confirmLabel: "削除する",
      tone: "danger",
      onConfirm: () => {
        void clearData().then((next) => {
          setState(next);
          setMessage("読み込み済みCSVデータを削除しました。");
        });
      }
    });
  }

  if (!state || !summary) {
    return <main className="app-shell loading">読み込み中...</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Zaim Budget</p>
          <h1>{currentTab.label}</h1>
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

      {tab === "settlement" && (
        <SettlementScreen
          summary={summary}
          hasData={state.transactions.length > 0}
          isImporting={isImporting}
          selectedMonth={selectedMonth}
          latestMonth={latestMonth}
          monthChoices={availableMonths}
          onMonthChange={setSelectedMonth}
          onReturnToLatestMonth={() => setSelectedMonth(latestMonth)}
          onImport={() => inputRef.current?.click()}
          onOpenBudgetDetails={(nextBudgetId) => {
            setBudgetId(nextBudgetId);
            setMethod("payment");
            setQuery("");
            setPeriodFilter({ type: "month", value: summary.month });
            setTab("details");
          }}
        />
      )}
      {tab === "analysis" && (
        <AnalysisScreen
          monthlySummaries={monthlySummaries}
          yearlySummaries={yearlySummaries}
          selectedMonth={selectedMonth}
          onSelectMonth={(month) => {
            setSelectedMonth(month);
            setPeriodFilter({ type: "month", value: month });
          }}
          onOpenMonthDetails={(month) => {
            setSelectedMonth(month);
            setPeriodFilter({ type: "month", value: month });
            setTab("settlement");
          }}
          onOpenMonthTransactions={(month) => {
            setPeriodFilter({ type: "month", value: month });
            setTab("details");
          }}
        />
      )}
      {tab === "details" && (
        <DetailsScreen
          rows={detailRows}
          state={state}
          query={query}
          method={method}
          budgetId={budgetId}
          periodFilter={periodFilter}
          months={monthOptions(state.transactions)}
          years={yearOptions(state.transactions)}
          setQuery={setQuery}
          setMethod={setMethod}
          setBudgetId={setBudgetId}
          setPeriodFilter={setPeriodFilter}
        />
      )}
      {tab === "budget" && (
        <BudgetScreen
          state={state}
          selectedMonth={selectedMonth}
          onBudgetChange={updateBudgetPlan}
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

      <nav className="bottom-tabs" aria-label="主要画面">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}>
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {confirmRequest && (
        <ConfirmDialog
          request={confirmRequest}
          onCancel={() => {
            confirmRequest.onCancel?.();
            setConfirmRequest(null);
          }}
          onConfirm={() => {
            const action = confirmRequest.onConfirm;
            setConfirmRequest(null);
            action();
          }}
        />
      )}
    </main>
  );
}

function SettlementScreen({
  summary,
  hasData,
  isImporting,
  selectedMonth,
  latestMonth,
  monthChoices,
  onMonthChange,
  onReturnToLatestMonth,
  onImport,
  onOpenBudgetDetails
}: {
  summary: NonNullable<ReturnType<typeof buildBudgetSummary>>;
  hasData: boolean;
  isImporting: boolean;
  selectedMonth: string;
  latestMonth: string;
  monthChoices: string[];
  onMonthChange: (month: string) => void;
  onReturnToLatestMonth: () => void;
  onImport: () => void;
  onOpenBudgetDetails: (budgetId: string) => void;
}) {
  const isLatestMonth = selectedMonth === latestMonth;
  const savingsRate = displaySavingsRate(summary, isLatestMonth);
  const savingsAmount = displaySavingsAmount(summary, isLatestMonth);
  const spendingAmount = isLatestMonth ? summary.projectedSpending : summary.spendingActual;
  const rateBarWidth = savingsRateBarPercent(savingsRate);
  const topSpendingRows = [...summary.rows].filter((row) => row.actual !== 0).sort((a, b) => b.projected - a.projected || b.actual - a.actual).slice(0, 3);
  const hiddenSpendingCount = Math.max(0, summary.rows.filter((row) => row.actual !== 0).length - topSpendingRows.length);
  const rateClass = savingsRate >= 0.2 ? "good" : savingsRate >= 0.1 ? "watch" : "bad";
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
          <label className="month-picker">
            <span>対象月</span>
            <select value={selectedMonth} onChange={(event) => onMonthChange(event.target.value)}>
              {monthChoices.map((month) => (
                <option value={month} key={month}>{month}</option>
              ))}
            </select>
            <button className="small-button" type="button" onClick={onReturnToLatestMonth} disabled={isLatestMonth}>
              最新月
            </button>
          </label>
          <section className={`settlement-summary ${rateClass}`}>
            <div className="summary-head">
              <div>
                <p>{summary.month} {isLatestMonth ? "見込み" : "実績"}</p>
                <strong>{isLatestMonth ? "残せる見込み" : "残せた金額"}</strong>
              </div>
              <em>{isLatestMonth ? "見込み" : "確定"}</em>
            </div>
            <div className="summary-kpi">
              <strong>{formatSignedYen(savingsAmount)}</strong>
              <span>{savingsRateJudgement(savingsRate)} / {compactGuidance(summary)}</span>
            </div>
            <div className="savings-rate-card">
              <div>
                <span>貯蓄率</span>
                <strong>{formatPercent(savingsRate)}</strong>
                <em>目標 {savingsRateTargetDelta(savingsRate)}</em>
              </div>
              <div className="savings-rate-bar" aria-label={`貯蓄率 ${formatPercent(savingsRate)} 目標20%`}>
                <i style={{ width: `${rateBarWidth}%` }} />
                <b aria-hidden="true" />
              </div>
            </div>
            <div className="summary-strip">
              <div>
                <span>収入</span>
                <strong>{yen.format(summary.effectiveIncome)}</strong>
              </div>
              <div>
                <span>支出</span>
                <strong>{yen.format(spendingAmount)}</strong>
              </div>
              <div>
                <span>貯蓄額</span>
                <strong>{formatSignedYen(savingsAmount)}</strong>
              </div>
              <div>
                <span>貯蓄率</span>
                <strong>{formatPercent(savingsRate)}</strong>
              </div>
            </div>
          </section>

          <section className="panel action-panel">
            <div className="section-title">
              <AlertTriangle size={18} />
              <div>
                <h2>支出上位</h2>
                <p>大きい費目から明細で確認できます。</p>
              </div>
            </div>
            {topSpendingRows.length === 0 ? (
              <div className="quiet-row">
                <CheckCircle2 size={18} />
                この月の支出はまだありません。
              </div>
            ) : (
              <div className="action-list">
                {topSpendingRows.map((row) => (
                  <article className="risk-row" key={row.id}>
                    <div>
                      <strong>{row.name}</strong>
                      <span>{row.classification} / {row.count}回</span>
                    </div>
                    <div className="risk-amount">
                      <b>{yen.format(row.projected)}</b>
                      <span>{isLatestMonth ? "見込み" : "実績"}</span>
                    </div>
                    <div className="bar" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, (row.projected / Math.max(1, topSpendingRows[0].projected)) * 100)}%` }} />
                    </div>
                    <button className="text-button" type="button" onClick={() => onOpenBudgetDetails(row.id)}>
                      明細を見る
                    </button>
                  </article>
                ))}
                {hiddenSpendingCount > 0 && <div className="more-risks">ほか{hiddenSpendingCount}件</div>}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function ConfirmDialog({
  request,
  onCancel,
  onConfirm
}: {
  request: ConfirmRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div>
          <p className="eyebrow">確認</p>
          <h2 id="confirm-title">{request.title}</h2>
        </div>
        <p>{request.message}</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button className={request.tone === "danger" ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailsScreen({
  rows,
  state,
  query,
  method,
  budgetId,
  periodFilter,
  months,
  years,
  setQuery,
  setMethod,
  setBudgetId,
  setPeriodFilter
}: {
  rows: AppState["transactions"];
  state: AppState;
  query: string;
  method: string;
  budgetId: string;
  periodFilter: PeriodFilter;
  months: string[];
  years: string[];
  setQuery: (value: string) => void;
  setMethod: (value: string) => void;
  setBudgetId: (value: string) => void;
  setPeriodFilter: (value: PeriodFilter) => void;
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
        <div className="select-row">
          <label>
            <BarChart3 size={16} />
            <select
              value={periodFilter.type}
              onChange={(event) => {
                const type = event.target.value as PeriodFilter["type"];
                setPeriodFilter({ type, value: type === "month" ? months[0] ?? "" : type === "year" ? years[0] ?? "" : "" });
              }}
            >
              <option value="all">全期間</option>
              <option value="year">年</option>
              <option value="month">月</option>
            </select>
          </label>
          {periodFilter.type !== "all" && (
            <label>
              <SlidersHorizontal size={16} />
              <select value={periodFilter.value} onChange={(event) => setPeriodFilter({ ...periodFilter, value: event.target.value })}>
                {(periodFilter.type === "month" ? months : years).map((value) => (
                  <option value={value} key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
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

function AnalysisScreen({
  monthlySummaries,
  yearlySummaries,
  selectedMonth,
  onSelectMonth,
  onOpenMonthDetails,
  onOpenMonthTransactions
}: {
  monthlySummaries: MonthlySummary[];
  yearlySummaries: YearlySummary[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  onOpenMonthDetails: (month: string) => void;
  onOpenMonthTransactions: (month: string) => void;
}) {
  const [mode, setMode] = useState<"monthly" | "yearly">("monthly");
  const latestYear = yearlySummaries.reduce((latest, summary) => (summary.year > latest ? summary.year : latest), "");
  const [selectedYear, setSelectedYear] = useState(latestYear);
  const selected = monthlySummaries.find((summary) => summary.month === selectedMonth) ?? monthlySummaries.at(-1);
  const selectedYearSummary = yearlySummaries.find((summary) => summary.year === selectedYear) ?? yearlySummaries.find((summary) => summary.year === latestYear);
  const selectedYearMonths = selectedYearSummary
    ? monthlySummaries.filter((summary) => summary.year === selectedYearSummary.year)
    : [];
  const recentMonths = monthlySummaries.slice(-24);

  useEffect(() => {
    if (!yearlySummaries.some((summary) => summary.year === selectedYear)) {
      setSelectedYear(latestYear);
    }
  }, [latestYear, selectedYear, yearlySummaries]);

  return (
    <section className="screen">
      <div className="segmented">
        <button className={mode === "monthly" ? "active" : ""} type="button" onClick={() => setMode("monthly")}>月別</button>
        <button className={mode === "yearly" ? "active" : ""} type="button" onClick={() => setMode("yearly")}>年別</button>
      </div>

      {mode === "monthly" ? (
        <>
          <section className="panel">
            <div className="section-title">
              <BarChart3 size={18} />
              <h2>月別推移</h2>
            </div>
            <div className="chart-legend" aria-hidden="true">
              <span><i className="legend-bar" />棒 = 貯蓄率</span>
              <span><i className="legend-deficit" />赤い棒 = 赤字</span>
              <span><i className="legend-line" />線 = 20%目標</span>
            </div>
            <div className="trend-chart" role="img" aria-label="月別貯蓄率の推移">
              {recentMonths.map((summary) => {
                const rateHeight = savingsRateBarPercent(summary.surplusRate);
                const estimatedLabel = summary.incomeWasEstimated ? " 収入補完" : "";
                return (
                  <button
                    key={summary.month}
                    className={`${summary.month === selected?.month ? "active" : ""} ${summary.surplus < 0 ? "deficit" : ""}`}
                    type="button"
                    onClick={() => onSelectMonth(summary.month)}
                    aria-label={`${summary.month} 貯蓄額${formatSignedYen(summary.surplus)} 貯蓄率${formatPercent(summary.surplusRate)}${estimatedLabel}`}
                  >
                    <i style={{ height: `${rateHeight}%` }} />
                    <b />
                    <span>{summary.month.slice(5)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {selected && (
            <section className="panel month-detail">
              <div>
                <span>{selected.month}</span>
                <strong>{formatPercent(selected.surplusRate)}</strong>
                <small>貯蓄率{selected.incomeWasEstimated ? "・収入補完" : ""}</small>
              </div>
              <div className="metric-grid">
                <Metric label="貯蓄額" value={formatSignedYen(selected.surplus)} tone={selected.surplus >= 0 ? "good" : "bad"} />
                <Metric label="支出" value={yen.format(selected.spendingActual)} />
                <Metric label="前年同月支出差" value={selected.previousYearSpendingDelta == null ? "-" : yen.format(selected.previousYearSpendingDelta)} tone={selected.previousYearSpendingDelta != null && selected.previousYearSpendingDelta <= 0 ? "good" : "bad"} />
                <Metric label="収入" value={yen.format(selected.effectiveIncome)} />
                <Metric label="前年同月貯蓄額差" value={selected.previousYearSurplusDelta == null ? "-" : formatSignedYen(selected.previousYearSurplusDelta)} tone={selected.previousYearSurplusDelta != null && selected.previousYearSurplusDelta >= 0 ? "good" : "bad"} />
              </div>
              <div className="action-row">
                <button className="secondary-button" type="button" onClick={() => onOpenMonthDetails(selected.month)}>決算で見る</button>
                <button className="secondary-button" type="button" onClick={() => onOpenMonthTransactions(selected.month)}>明細を見る</button>
              </div>
            </section>
          )}

          <div className="month-list">
            {[...monthlySummaries].reverse().map((summary) => (
              <button className="month-row" key={summary.month} type="button" onClick={() => onSelectMonth(summary.month)}>
                <div>
                  <strong>{summary.month}</strong>
                  <span>貯蓄額 {formatSignedYen(summary.surplus)}{summary.incomeWasEstimated ? "・収入補完" : ""}</span>
                  <span>前年差 {summary.previousYearSurplusDelta == null ? "-" : formatSignedYen(summary.previousYearSurplusDelta)}</span>
                </div>
                <div>
                  <b>{formatPercent(summary.surplusRate)}</b>
                  <small>貯蓄率</small>
                  <span>支出 {yen.format(summary.spendingActual)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <section className="panel">
            <div className="section-title">
              <BarChart3 size={18} />
              <div>
                <h2>年別貯蓄率</h2>
                <p>バーは貯蓄率、線は20%目標です。</p>
              </div>
            </div>
            <div className="year-savings-chart" role="img" aria-label="年別貯蓄率と貯蓄額">
              {yearlySummaries.map((summary) => {
                const barWidth = savingsRateBarPercent(summary.surplusRate);
                return (
                  <button
                    className={`year-savings-row ${summary.year === selectedYearSummary?.year ? "active" : ""} ${summary.surplus < 0 ? "deficit" : ""}`}
                    key={summary.year}
                    type="button"
                    onClick={() => setSelectedYear(summary.year)}
                    aria-pressed={summary.year === selectedYearSummary?.year}
                    aria-label={`${summary.year} 貯蓄額${formatSignedYen(summary.surplus)} 貯蓄率${formatPercent(summary.surplusRate)}`}
                  >
                    <span>{summary.year}</span>
                    <div className="year-rate-track" aria-hidden="true"><i style={{ width: `${barWidth}%` }} /></div>
                    <strong>{formatSignedYen(summary.surplus)}</strong>
                    <em>貯蓄率 {formatPercent(summary.surplusRate)}</em>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedYearSummary && (
            <section className="panel year-card year-detail">
                <div className="year-head">
                  <div>
                    <span>{selectedYearSummary.monthCount}ヶ月累計</span>
                    <h2>{selectedYearSummary.year}</h2>
                  </div>
                  <strong>{formatSignedYen(selectedYearSummary.surplus)}</strong>
                  <small>年間貯蓄額</small>
                </div>
                <div className="metric-grid">
                  <Metric label="年間貯蓄率" value={formatPercent(selectedYearSummary.surplusRate)} tone={selectedYearSummary.surplusRate >= 0.2 ? "good" : "bad"} />
                  <Metric label="年間収入" value={yen.format(selectedYearSummary.effectiveIncome)} />
                  <Metric label="年間支出" value={yen.format(selectedYearSummary.spendingActual)} />
                  <Metric label="月平均支出" value={yen.format(selectedYearSummary.monthlyAverageSpending)} />
                </div>

                <div className="year-detail-section">
                  <h3>月別累計</h3>
                  <div className="year-month-list">
                    {selectedYearMonths.map((month) => (
                      <div className="year-month-row" key={month.month}>
                        <div>
                          <strong>{month.month}</strong>
                          <span>貯蓄額 {formatSignedYen(month.surplus)}{month.incomeWasEstimated ? "・収入補完" : ""}</span>
                        </div>
                        <div>
                          <b>{formatPercent(month.surplusRate)}</b>
                          <span>収入 {yen.format(month.effectiveIncome)} / 支出 {yen.format(month.spendingActual)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="year-detail-section">
                  <h3>支出上位費目</h3>
                <div className="category-table">
                  {selectedYearSummary.categoryTotals.slice(0, 8).map((row) => (
                    <div key={row.id}>
                      <span>{row.name}</span>
                      <b>{yen.format(row.amount)}</b>
                    </div>
                  ))}
                </div>
                </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function BudgetScreen({
  state,
  selectedMonth,
  onBudgetChange,
  onIncomeChange,
  onReset
}: {
  state: AppState;
  selectedMonth: string;
  onBudgetChange: (items: BudgetItem[], effectiveMonth: string) => Promise<void>;
  onIncomeChange: (value: number) => Promise<void>;
  onReset: () => void;
}) {
  const [effectiveMonth, setEffectiveMonth] = useState(selectedMonth || toMonthKey(new Date().toISOString()));

  function updateAmount(id: string, value: number) {
    const next = state.budgetItems.map((item) => (item.id === id ? { ...item, monthlyBudget: Math.max(0, value) } : item));
    void onBudgetChange(next, effectiveMonth);
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
      <section className="panel budget-income">
        <label>
          <span>この月から適用</span>
          <input type="month" value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} />
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
      <button className="danger-button" type="button" onClick={() => onReset()}>
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
  onDelete: () => void;
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
        <Metadata label="月数 / 年数" value={`${state.metadata?.monthCount ?? 0}ヶ月 / ${state.metadata?.yearCount ?? 0}年`} />
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

function displaySavingsRate(summary: NonNullable<ReturnType<typeof buildBudgetSummary>>, isLatestMonth: boolean): number {
  return isLatestMonth ? summary.projectedSurplusRate : summary.surplusRate;
}

function displaySavingsAmount(summary: NonNullable<ReturnType<typeof buildBudgetSummary>>, isLatestMonth: boolean): number {
  return isLatestMonth ? summary.projectedSurplus : summary.surplus;
}

function savingsRateBarPercent(rate: number): number {
  return Math.min(100, Math.max(0, Math.abs(rate) * 100));
}

function savingsRateJudgement(rate: number): string {
  if (rate >= 0.4) return "かなり優秀";
  if (rate >= 0.2) return "目標クリア";
  if (rate >= 0.1) return "あと少し";
  return "要改善";
}

function compactGuidance(summary: NonNullable<ReturnType<typeof buildBudgetSummary>>): string {
  const topSpending = [...summary.rows].filter((row) => row.actual !== 0).sort((a, b) => b.projected - a.projected || b.actual - a.actual)[0];
  if (!topSpending) return "支出はまだありません";
  return `最大支出は${topSpending.name}`;
}

function savingsRateTargetDelta(rate: number): string {
  const points = Math.round((rate - 0.2) * 1000) / 10;
  return `${points >= 0 ? "+" : ""}${points}pt`;
}

function formatSignedYen(value: number): string {
  return `${value >= 0 ? "+" : ""}${yen.format(value)}`;
}

function normalizeIssue(error: unknown): ImportIssue {
  if (typeof error === "object" && error && "message" in error) {
    return error as ImportIssue;
  }
  return { message: String(error) };
}
