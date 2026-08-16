import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  FileCheck2,
  FileUp,
  Minus,
  Plus,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  WalletCards,
  X
} from "lucide-react";
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
      setMessage(`${parsed.metadata.rowCount.toLocaleString("ja-JP")}件のデータを読み込みました。`);
    } catch (error) {
      setIssue(normalizeIssue(error));
    } finally {
      setIsImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
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
    return (
      <main className="app-shell loading">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Sparkles className="animate-spin" size={32} color="#059669" />
          <p>データを読み込んでいます...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-badge">
            <Sparkles size={14} />
            <span>Zaim Budget</span>
          </div>
          <h1>{currentTab.label}</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="CSVを読み込む"
            title="CSVを読み込む"
          >
            <FileUp size={20} />
          </button>
        </div>
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

      <div className="notice-container">
        {message && (
          <div className="notice success">
            <div className="notice-content">
              <CheckCircle2 size={18} />
              <span>{message}</span>
            </div>
            <button className="notice-close" onClick={() => setMessage("")} aria-label="閉じる">
              <X size={16} />
            </button>
          </div>
        )}
        {issue && (
          <div className="notice danger">
            <div className="notice-content">
              <AlertTriangle size={18} />
              <span>
                {issue.row ? `${issue.row}行目 ` : ""}
                {issue.column ? `${issue.column}: ` : ""}
                {issue.message}
              </span>
            </div>
            <button className="notice-close" onClick={() => setIssue(null)} aria-label="閉じる">
              <X size={16} />
            </button>
          </div>
        )}
      </div>

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
          onImportFile={importFile}
          onTriggerFileSelect={() => inputRef.current?.click()}
          onDelete={deleteImportedData}
        />
      )}

      <nav className="bottom-tabs" aria-label="主要画面">
        {tabs.map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button key={item.id} className={isActive ? "active" : ""} type="button" onClick={() => setTab(item.id)}>
              <Icon size={20} />
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

/* ==========================================================================
   Settlement Screen (決算)
   ========================================================================== */

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
  const status = rateStatus(savingsRate, isCurrentMonth(summary.month));
  const topSpendingRows = [...summary.rows]
    .filter((row) => row.actual !== 0)
    .sort((a, b) => b.projected - a.projected || b.actual - a.actual)
    .slice(0, 4);
  const hiddenSpendingCount = Math.max(0, summary.rows.filter((row) => row.actual !== 0).length - topSpendingRows.length);

  const currentIndex = monthChoices.indexOf(selectedMonth);
  const canGoPrev = currentIndex < monthChoices.length - 1 && currentIndex !== -1;
  const canGoNext = currentIndex > 0;

  function goPrev() {
    if (canGoPrev) onMonthChange(monthChoices[currentIndex + 1]);
  }
  function goNext() {
    if (canGoNext) onMonthChange(monthChoices[currentIndex - 1]);
  }

  return (
    <section className="screen settlement">
      {!hasData ? (
        <div className="empty-card">
          <div className="empty-card-icon">
            <UploadCloud size={28} />
          </div>
          <h3>CSVを読み込むと家計分析が始まります</h3>
          <p>ZaimからエクスポートしたCSVファイルを読み込んで、今月の貯蓄率と着地見込みを確認しましょう。</p>
          <button className="primary-button" type="button" onClick={onImport} disabled={isImporting} style={{ marginTop: 8 }}>
            <FileUp size={18} />
            CSVファイルを選択
          </button>
        </div>
      ) : (
        <>
          {/* Month Toolbar */}
          <div className="month-toolbar">
            <div className="month-stepper">
              <button
                className="month-stepper-btn"
                type="button"
                onClick={goPrev}
                disabled={!canGoPrev}
                aria-label="前月へ"
                title="前月へ"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="month-dropdown-wrap">
                <select
                  className="month-select"
                  value={selectedMonth}
                  onChange={(event) => onMonthChange(event.target.value)}
                  aria-label="対象月を選択"
                >
                  {monthChoices.map((month) => (
                    <option value={month} key={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="month-select-chevron" />
              </div>
              <button
                className="month-stepper-btn"
                type="button"
                onClick={goNext}
                disabled={!canGoNext}
                aria-label="次月へ"
                title="次月へ"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              className="btn-latest-month"
              type="button"
              onClick={onReturnToLatestMonth}
              disabled={isLatestMonth}
            >
              <Clock size={13} />
              最新月
            </button>
          </div>

          {/* Hero KPI Card */}
          <section className={`settlement-hero ${status}`}>
            <div className="hero-header">
              <div className="hero-header-info">
                <span className="hero-month-label">{summary.month} 家計サマリー</span>
                <strong className="hero-status-title">{rateStatusTitle(status)}</strong>
              </div>
              <span className="status-badge">
                {status === "tentative" && <Clock size={13} />}
                {status === "achieved" && <CheckCircle2 size={13} />}
                {status === "missed" && <AlertTriangle size={13} />}
                {status === "tentative" ? "当月途中" : "月次確定"}
              </span>
            </div>

            <div className="hero-amount-block">
              <span className="hero-amount-label">当月貯蓄額（{isLatestMonth ? "着地見込み" : "確定実績"}）</span>
              <strong className={`hero-amount-val ${savingsAmount >= 0 ? "positive" : "negative"}`}>
                {formatSignedYen(savingsAmount)}
              </strong>
            </div>

            {/* Savings Rate Progress */}
            <div className="savings-progress-box">
              <div className="savings-progress-header">
                <span className="savings-progress-label">貯蓄率</span>
                <div className="savings-progress-values">
                  <strong className="savings-progress-rate num-tabular">{formatPercent(savingsRate)}</strong>
                  <span className="target-delta-badge">目標 {savingsRateTargetDelta(savingsRate)}</span>
                </div>
              </div>
              <div className="progress-track-wrap" aria-label={`貯蓄率 ${formatPercent(savingsRate)} (目標20%)`}>
                <div className="progress-fill-bar" style={{ width: `${rateBarWidth}%` }} />
                <div className="target-marker-line" title="目標ライン (20%)" />
              </div>
              <div className="progress-legend-row">
                <span>0%</span>
                <span style={{ position: "relative", left: "calc(20% - 14px)", color: "var(--text-main)", fontWeight: 750 }}>20% 目標</span>
                <span>100%</span>
              </div>
            </div>
          </section>

          {/* 4-Grid Metrics */}
          <section className="metrics-grid-4">
            <div className="metric-card">
              <div className="metric-card-header">
                <span className="metric-card-label">収入</span>
                <TrendingUp size={15} color="var(--primary)" />
              </div>
              <strong className="metric-card-val num-tabular">{yen.format(summary.effectiveIncome)}</strong>
              <span className="metric-card-sub">実収入 + 補完</span>
            </div>

            <div className="metric-card">
              <div className="metric-card-header">
                <span className="metric-card-label">支出</span>
                <TrendingDown size={15} color="var(--danger)" />
              </div>
              <strong className="metric-card-val num-tabular">{yen.format(spendingAmount)}</strong>
              <span className="metric-card-sub">{isLatestMonth ? "月内消化ペース見込み" : "確定実績"}</span>
            </div>

            <div className={`metric-card ${savingsAmount >= 0 ? "good" : "bad"}`}>
              <div className="metric-card-header">
                <span className="metric-card-label">貯蓄額</span>
              </div>
              <strong className="metric-card-val num-tabular">{formatSignedYen(savingsAmount)}</strong>
              <span className="metric-card-sub">{savingsAmount >= 0 ? "黒字" : "赤字"}</span>
            </div>

            <div className={`metric-card ${savingsRate >= 0.2 ? "good" : "bad"}`}>
              <div className="metric-card-header">
                <span className="metric-card-label">貯蓄率</span>
              </div>
              <strong className="metric-card-val num-tabular">{formatPercent(savingsRate)}</strong>
              <span className="metric-card-sub">目標20%</span>
            </div>
          </section>

          {/* Top Spending Items */}
          <section className="card">
            <div className="card-title-row">
              <div className="card-title-group">
                <ReceiptText size={18} />
                <h2>支出上位費目</h2>
              </div>
              <span className="card-subtitle">大きい費目から明細で確認</span>
            </div>

            {topSpendingRows.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 0", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                <CheckCircle2 size={18} color="var(--success)" />
                <span>この月の支出データはありません。</span>
              </div>
            ) : (
              <div className="top-spending-list">
                {topSpendingRows.map((row, index) => {
                  const maxProjected = Math.max(1, topSpendingRows[0].projected);
                  const barWidth = Math.min(100, (row.projected / maxProjected) * 100);
                  return (
                    <article className="spending-item-card" key={row.id}>
                      <div className="spending-item-top">
                        <div className="spending-item-name-group">
                          <span className="spending-rank-badge">{index + 1}</span>
                          <div>
                            <div className="spending-item-name">{row.name}</div>
                            <div className="spending-item-meta">{row.detail} · {row.count}回</div>
                          </div>
                        </div>
                        <div className="spending-item-amount-group">
                          <div className="spending-item-amount num-tabular">{yen.format(row.projected)}</div>
                          <div className="spending-item-tag">{isLatestMonth ? "着地見込み" : "実績"}</div>
                        </div>
                      </div>

                      <div className="spending-bar-wrap" aria-hidden="true">
                        <div className="spending-bar-fill" style={{ width: `${barWidth}%` }} />
                      </div>

                      <div className="spending-item-footer">
                        <button
                          className="btn-detail-link"
                          type="button"
                          onClick={() => onOpenBudgetDetails(row.id)}
                        >
                          明細を見る
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </article>
                  );
                })}
                {hiddenSpendingCount > 0 && (
                  <div style={{ textAlign: "center", fontSize: "0.78rem", color: "var(--text-dim)", paddingTop: 4 }}>
                    ほか {hiddenSpendingCount} 件の費目
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

/* ==========================================================================
   Analysis Screen (分析)
   ========================================================================== */

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
  const selectedYearSummary =
    yearlySummaries.find((summary) => summary.year === selectedYear) ??
    yearlySummaries.find((summary) => summary.year === latestYear);
  const selectedYearMonths = selectedYearSummary
    ? monthlySummaries.filter((summary) => summary.year === selectedYearSummary.year)
    : [];
  const recentMonths = monthlySummaries.slice(-24);
  const selectedYearHasTentativeMonth = selectedYearMonths.some((summary) => isCurrentMonth(summary.month));

  useEffect(() => {
    if (!yearlySummaries.some((summary) => summary.year === selectedYear)) {
      setSelectedYear(latestYear);
    }
  }, [latestYear, selectedYear, yearlySummaries]);

  return (
    <section className="screen analysis-screen">
      {/* Segmented Switch */}
      <div className="segmented-control">
        <button
          className={mode === "monthly" ? "active" : ""}
          type="button"
          onClick={() => setMode("monthly")}
        >
          月別推移
        </button>
        <button
          className={mode === "yearly" ? "active" : ""}
          type="button"
          onClick={() => setMode("yearly")}
        >
          年別集計
        </button>
      </div>

      {mode === "monthly" ? (
        <>
          {/* Monthly Trend Chart */}
          <section className="card chart-card">
            <div className="card-title-row">
              <div className="card-title-group">
                <BarChart3 size={18} />
                <h2>月別貯蓄率推移</h2>
              </div>
              <span className="card-subtitle">直近24ヶ月</span>
            </div>

            <div className="chart-legend-modern" aria-hidden="true">
              <span className="legend-chip">
                <i className="legend-dot achieved" /> 達成 (20%以上)
              </span>
              <span className="legend-chip">
                <i className="legend-dot missed" /> 未達
              </span>
              <span className="legend-chip">
                <i className="legend-dot tentative" /> 未確定
              </span>
              <span className="legend-chip">
                <i className="legend-dot target" /> 20% 目標線
              </span>
            </div>

            <div className="monthly-chart-scroll">
              <div className="monthly-bars-track" role="img" aria-label="月別貯蓄率チャート">
                <div className="chart-target-line" />
                {recentMonths.map((item) => {
                  const rateHeight = savingsRateBarPercent(item.surplusRate);
                  const isTentative = isCurrentMonth(item.month);
                  const status = rateStatus(item.surplusRate, isTentative);
                  const isSelected = item.month === selected?.month;

                  return (
                    <button
                      key={item.month}
                      className={`bar-col-button ${status} ${isSelected ? "active" : ""}`}
                      type="button"
                      onClick={() => onSelectMonth(item.month)}
                      aria-label={`${item.month} 貯蓄率${formatPercent(item.surplusRate)}`}
                      title={`${item.month}: 貯蓄率 ${formatPercent(item.surplusRate)}`}
                    >
                      <div className="bar-pill" style={{ height: `${Math.max(4, rateHeight * 0.75)}%` }} />
                      <span className="bar-label-month">{item.month.slice(5)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Selected Month Detail */}
          {selected && (
            <section className="selected-month-card">
              <div className="selected-month-header">
                <div>
                  <span style={{ fontSize: "0.84rem", color: "var(--text-muted)", fontWeight: 750 }}>
                    {selected.month} 詳細
                  </span>
                  <div className={`selected-month-rate num-tabular ${rateStatus(selected.surplusRate, isCurrentMonth(selected.month))}`}>
                    {formatPercent(selected.surplusRate)}
                  </div>
                </div>
                <span className="status-badge">
                  {rateStatusLabel(rateStatus(selected.surplusRate, isCurrentMonth(selected.month)))}
                  {selected.incomeWasEstimated ? " · 収入補完" : ""}
                </span>
              </div>

              <div className="comparison-grid">
                <div className="comparison-chip">
                  <span className="comparison-chip-label">貯蓄額</span>
                  <strong className={`comparison-chip-val num-tabular ${selected.surplus >= 0 ? "good" : "bad"}`}>
                    {formatSignedYen(selected.surplus)}
                  </strong>
                </div>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">支出実績</span>
                  <strong className="comparison-chip-val num-tabular">{yen.format(selected.spendingActual)}</strong>
                </div>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">前年同月支出差</span>
                  <strong
                    className={`comparison-chip-val num-tabular ${
                      selected.previousYearSpendingDelta != null && selected.previousYearSpendingDelta <= 0
                        ? "good"
                        : "bad"
                    }`}
                  >
                    {selected.previousYearSpendingDelta == null ? "-" : yen.format(selected.previousYearSpendingDelta)}
                  </strong>
                </div>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">前年同月貯蓄額差</span>
                  <strong
                    className={`comparison-chip-val num-tabular ${
                      selected.previousYearSurplusDelta != null && selected.previousYearSurplusDelta >= 0
                        ? "good"
                        : "bad"
                    }`}
                  >
                    {selected.previousYearSurplusDelta == null ? "-" : formatSignedYen(selected.previousYearSurplusDelta)}
                  </strong>
                </div>
              </div>

              <div className="quick-action-row">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onOpenMonthDetails(selected.month)}
                >
                  <WalletCards size={16} />
                  決算で確認
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onOpenMonthTransactions(selected.month)}
                >
                  <ReceiptText size={16} />
                  明細一覧
                </button>
              </div>
            </section>
          )}

          {/* Month List */}
          <div className="history-list">
            {[...monthlySummaries].reverse().map((item) => {
              const status = rateStatus(item.surplusRate, isCurrentMonth(item.month));
              return (
                <button
                  className="history-item-btn"
                  key={item.month}
                  type="button"
                  onClick={() => onSelectMonth(item.month)}
                >
                  <div className="history-item-left">
                    <span className="history-item-month">{item.month}</span>
                    <span className="history-item-sub">
                      貯蓄 {formatSignedYen(item.surplus)} · 支出 {yen.format(item.spendingActual)}
                    </span>
                  </div>
                  <div className="history-item-right">
                    <strong className={`history-item-rate num-tabular ${status}`}>
                      {formatPercent(item.surplusRate)}
                    </strong>
                    <span className="history-item-sub">
                      前年差 {item.previousYearSurplusDelta == null ? "-" : formatSignedYen(item.previousYearSurplusDelta)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Yearly Chart */}
          <section className="card">
            <div className="card-title-row">
              <div className="card-title-group">
                <BarChart3 size={18} />
                <h2>年別貯蓄率</h2>
              </div>
              <span className="card-subtitle">目標20%ライン</span>
            </div>

            <div className="yearly-bars-group">
              {yearlySummaries.map((summary) => {
                const barWidth = savingsRateBarPercent(summary.surplusRate);
                const hasTentativeMonth = monthlySummaries.some(
                  (m) => m.year === summary.year && isCurrentMonth(m.month)
                );
                const status = rateStatus(summary.surplusRate, hasTentativeMonth);
                const isSelected = summary.year === selectedYearSummary?.year;

                return (
                  <button
                    className={`yearly-row-btn ${status} ${isSelected ? "active" : ""}`}
                    key={summary.year}
                    type="button"
                    onClick={() => setSelectedYear(summary.year)}
                  >
                    <span className="yearly-row-year">{summary.year}</span>
                    <div className="yearly-bar-container">
                      <div className="yearly-track">
                        <div className="yearly-bar-fill" style={{ width: `${barWidth}%` }} />
                      </div>
                      <span className="yearly-row-rate-sub">
                        貯蓄率 {formatPercent(summary.surplusRate)}
                        {hasTentativeMonth ? " · 途中月あり" : ""}
                      </span>
                    </div>
                    <strong className="yearly-row-amount num-tabular">{formatSignedYen(summary.surplus)}</strong>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Selected Year Detail */}
          {selectedYearSummary && (
            <section className="card">
              <div className="card-title-row">
                <div>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700 }}>
                    {selectedYearSummary.monthCount}ヶ月累計
                  </span>
                  <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }}>{selectedYearSummary.year} 年間実績</h2>
                </div>
                <strong
                  style={{
                    fontSize: "1.4rem",
                    fontWeight: 850,
                    color: selectedYearSummary.surplus >= 0 ? "var(--primary)" : "var(--danger)"
                  }}
                  className="num-tabular"
                >
                  {formatSignedYen(selectedYearSummary.surplus)}
                </strong>
              </div>

              <div className="comparison-grid" style={{ marginTop: 12 }}>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">年間貯蓄率</span>
                  <strong
                    className={`comparison-chip-val num-tabular ${
                      selectedYearSummary.surplusRate >= 0.2 ? "good" : "bad"
                    }`}
                  >
                    {formatPercent(selectedYearSummary.surplusRate)}
                  </strong>
                </div>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">年間収入</span>
                  <strong className="comparison-chip-val num-tabular">
                    {yen.format(selectedYearSummary.effectiveIncome)}
                  </strong>
                </div>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">年間支出</span>
                  <strong className="comparison-chip-val num-tabular">
                    {yen.format(selectedYearSummary.spendingActual)}
                  </strong>
                </div>
                <div className="comparison-chip">
                  <span className="comparison-chip-label">月平均支出</span>
                  <strong className="comparison-chip-val num-tabular">
                    {yen.format(selectedYearSummary.monthlyAverageSpending)}
                  </strong>
                </div>
              </div>

              {/* Monthly breakdown within year */}
              <div style={{ marginTop: 18 }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 750, color: "var(--text-muted)", marginBottom: 8 }}>
                  月別内訳
                </h3>
                <div className="history-list">
                  {selectedYearMonths.map((m) => (
                    <div
                      key={m.month}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        background: "var(--surface-card-subtle)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "0.86rem"
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong>{m.month}</strong>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          収 {yen.format(m.effectiveIncome)} / 支 {yen.format(m.spendingActual)}
                        </span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong className="num-tabular">{formatSignedYen(m.surplus)}</strong>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          貯蓄率 {formatPercent(m.surplusRate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top spending categories */}
              <div style={{ marginTop: 18 }}>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 750, color: "var(--text-muted)", marginBottom: 8 }}>
                  年間支出上位費目
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {selectedYearSummary.categoryTotals.slice(0, 8).map((cat, idx) => (
                    <div
                      key={cat.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderBottom: "1px solid var(--border-subtle)",
                        fontSize: "0.88rem"
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", width: 18 }}>{idx + 1}.</span>
                        <strong>{cat.name}</strong>
                      </span>
                      <strong className="num-tabular">{yen.format(cat.amount)}</strong>
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

/* ==========================================================================
   Details Screen (明細)
   ========================================================================== */

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
  const methodFilterOptions = [
    { value: "all", label: "すべて" },
    { value: "payment", label: "支出" },
    { value: "income", label: "収入" },
    { value: "transfer", label: "振替" },
    { value: "balance", label: "残高" }
  ];

  const totalAmount = useMemo(() => {
    return rows.reduce((acc, curr) => acc + displayAmount(curr), 0);
  }, [rows]);

  return (
    <section className="screen details-screen">
      {/* Filters Card */}
      <div className="filter-panel-card">
        {/* Search Field */}
        <div className="search-field-wrap">
          <Search size={17} className="search-field-icon" />
          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="店名・品目・メモ・カテゴリで検索"
          />
          {query && (
            <button className="search-clear-btn" type="button" onClick={() => setQuery("")} aria-label="検索クリア">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Method Pills */}
        <div className="filter-pills-row" role="group" aria-label="収支タイプ絞り込み">
          {methodFilterOptions.map((opt) => (
            <button
              key={opt.value}
              className={`filter-pill ${method === opt.value ? "active" : ""}`}
              type="button"
              onClick={() => setMethod(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Dropdowns row */}
        <div className="filter-selects-row">
          <div className="select-box-wrap">
            <select value={budgetId} onChange={(e) => setBudgetId(e.target.value)} aria-label="予算費目で絞り込み">
              <option value="all">すべての費目</option>
              {state.budgetItems.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>

          <div className="select-box-wrap">
            <select
              value={periodFilter.type}
              onChange={(e) => {
                const type = e.target.value as PeriodFilter["type"];
                setPeriodFilter({
                  type,
                  value: type === "month" ? months[0] ?? "" : type === "year" ? years[0] ?? "" : ""
                });
              }}
              aria-label="期間種別"
            >
              <option value="all">全期間</option>
              <option value="year">年単位</option>
              <option value="month">月単位</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </div>

        {periodFilter.type !== "all" && (
          <div className="select-box-wrap">
            <select
              value={periodFilter.value}
              onChange={(e) => setPeriodFilter({ ...periodFilter, value: e.target.value })}
              aria-label="詳細期間選択"
            >
              {(periodFilter.type === "month" ? months : years).map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        )}

        {/* Details Summary Strip */}
        <div className="details-summary-strip">
          <span>
            該当 <strong>{rows.length}</strong> 件
          </span>
          <span>
            合計 <strong className="num-tabular">{yen.format(totalAmount)}</strong>
          </span>
        </div>
      </div>

      {/* Transaction List */}
      {rows.length === 0 ? (
        <div className="empty-card">
          <div className="empty-card-icon">
            <Search size={24} />
          </div>
          <h3>該当する明細がありません</h3>
          <p>検索キーワードまたはフィルター条件を変更してください。</p>
        </div>
      ) : (
        <div className="transaction-list">
          {rows.map((transaction) => {
            const isIncome = transaction.method === "income";
            const isTransfer = transaction.method === "transfer";
            const amt = displayAmount(transaction);
            const mainTitle =
              transaction.shop ||
              transaction.item ||
              transaction.subcategory ||
              transaction.category ||
              methodLabels[transaction.method];

            return (
              <article className="transaction-card" key={transaction.id}>
                <div className="transaction-left">
                  <div className="transaction-date-row">
                    <span className="transaction-date">{formatDate(transaction.date)}</span>
                    <span
                      className={`transaction-badge ${
                        isIncome ? "income" : isTransfer ? "transfer" : ""
                      }`}
                    >
                      {methodLabels[transaction.method]}
                    </span>
                    <span className="transaction-badge">{budgetNameFor(transaction, state.budgetItems)}</span>
                  </div>
                  <strong className="transaction-title">{mainTitle}</strong>
                  {transaction.memo && <span className="transaction-memo">{transaction.memo}</span>}
                </div>
                <strong className={`transaction-amount ${isIncome ? "income" : ""}`}>
                  {isIncome ? "+" : ""}
                  {yen.format(amt)}
                </strong>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ==========================================================================
   Budget Screen (予算)
   ========================================================================== */

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

  const totalSpendingBudget = useMemo(() => {
    return state.budgetItems.reduce((acc, curr) => acc + (curr.monthlyBudget || 0), 0);
  }, [state.budgetItems]);

  const targetSavings = state.settings.monthlyIncomeEstimate - totalSpendingBudget;
  const targetSavingsRate =
    state.settings.monthlyIncomeEstimate > 0 ? targetSavings / state.settings.monthlyIncomeEstimate : 0;

  function updateAmount(id: string, value: number) {
    const next = state.budgetItems.map((item) =>
      item.id === id ? { ...item, monthlyBudget: Math.max(0, value) } : item
    );
    void onBudgetChange(next, effectiveMonth);
  }

  function adjustIncome(delta: number) {
    const next = Math.max(0, state.settings.monthlyIncomeEstimate + delta);
    void onIncomeChange(next);
  }

  function adjustBudget(id: string, delta: number) {
    const item = state.budgetItems.find((i) => i.id === id);
    if (item) {
      updateAmount(id, Math.max(0, item.monthlyBudget + delta));
    }
  }

  return (
    <section className="screen budget-screen">
      {/* Live Simulation Card */}
      <section className="budget-simulator-card">
        <div className="budget-sim-header">
          <span>予算シミュレーション</span>
          <span className="status-badge" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>
            目標貯蓄率 20%
          </span>
        </div>
        <div>
          <span style={{ fontSize: "0.78rem", color: "#a7f3d0" }}>シミュレーション貯蓄率</span>
          <div className="budget-sim-target-rate num-tabular">{formatPercent(targetSavingsRate)}</div>
        </div>

        <div className="budget-sim-grid">
          <div className="budget-sim-stat">
            <span>月収見込み</span>
            <strong className="num-tabular">{yen.format(state.settings.monthlyIncomeEstimate)}</strong>
          </div>
          <div className="budget-sim-stat">
            <span>予算支出合計</span>
            <strong className="num-tabular">{yen.format(totalSpendingBudget)}</strong>
          </div>
          <div className="budget-sim-stat">
            <span>予定貯蓄額</span>
            <strong className="num-tabular">{formatSignedYen(targetSavings)}</strong>
          </div>
        </div>
      </section>

      {/* Income Estimate Setting */}
      <section className="input-panel-card">
        <div className="input-panel-info">
          <label className="input-panel-label" htmlFor="income-input">月収見込み</label>
          <span className="input-panel-desc">貯蓄率計算の基準となる月収</span>
        </div>
        <div className="quick-stepper-input">
          <button
            className="stepper-btn"
            type="button"
            onClick={() => adjustIncome(-10000)}
            aria-label="1万円減額"
          >
            <Minus size={14} />
          </button>
          <input
            id="income-input"
            className="stepper-num-field"
            inputMode="numeric"
            type="number"
            min="0"
            step="10000"
            value={state.settings.monthlyIncomeEstimate}
            onChange={(e) => void onIncomeChange(Number(e.target.value))}
          />
          <button
            className="stepper-btn"
            type="button"
            onClick={() => adjustIncome(10000)}
            aria-label="1万円増額"
          >
            <Plus size={14} />
          </button>
        </div>
      </section>

      {/* Effective Month */}
      <section className="input-panel-card">
        <div className="input-panel-info">
          <label className="input-panel-label" htmlFor="effective-month-input">適用開始月</label>
          <span className="input-panel-desc">この月以降の計画に反映</span>
        </div>
        <input
          id="effective-month-input"
          type="month"
          value={effectiveMonth}
          onChange={(e) => setEffectiveMonth(e.target.value)}
          style={{
            height: 36,
            padding: "0 10px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
            fontWeight: 750
          }}
        />
      </section>

      {/* Budget Items List */}
      <div className="budget-items-list">
        {state.budgetItems.map((item) => (
          <div className="budget-item-card" key={item.id}>
            <div className="budget-item-left">
              <strong className="budget-item-name">{item.name}</strong>
              <span className="budget-item-detail">{item.detail}</span>
            </div>
            <div className="quick-stepper-input">
              <button
                className="stepper-btn"
                type="button"
                onClick={() => adjustBudget(item.id, -1000)}
                aria-label={`${item.name} 1千円減額`}
              >
                <Minus size={14} />
              </button>
              <input
                className="stepper-num-field"
                inputMode="numeric"
                type="number"
                min="0"
                step="1000"
                value={item.monthlyBudget}
                onChange={(e) => updateAmount(item.id, Number(e.target.value))}
                aria-label={`${item.name}の月予算額`}
              />
              <button
                className="stepper-btn"
                type="button"
                onClick={() => adjustBudget(item.id, 1000)}
                aria-label={`${item.name} 1千円増額`}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="danger-button" type="button" onClick={() => onReset()}>
        <RefreshCcw size={16} />
        初期予算設定に戻す
      </button>
    </section>
  );
}

/* ==========================================================================
   CSV Screen (CSV管理)
   ========================================================================== */

function CsvScreen({
  state,
  isImporting,
  onImportFile,
  onTriggerFileSelect,
  onDelete
}: {
  state: AppState;
  isImporting: boolean;
  onImportFile: (file: File) => void;
  onTriggerFileSelect: () => void;
  onDelete: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onImportFile(file);
    }
  }

  return (
    <section className="screen csv-screen">
      {/* Drag & Drop Zone */}
      <div
        className={`dropzone-card ${isDragging ? "dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onTriggerFileSelect}
        role="button"
        tabIndex={0}
        aria-label="CSVファイルをドロップまたはクリックして選択"
      >
        <div className="dropzone-icon-circle">
          <UploadCloud size={28} />
        </div>
        <strong className="dropzone-title">{isImporting ? "読み込み中..." : "Zaim CSVを選択またはドロップ"}</strong>
        <p className="dropzone-sub">
          ブラウザ端末内のIndexedDBにのみ保存され、外部サーバへ送信されることはありません。
        </p>
        <button
          className="primary-button"
          type="button"
          disabled={isImporting}
          onClick={(e) => {
            e.stopPropagation();
            onTriggerFileSelect();
          }}
          style={{ marginTop: 6 }}
        >
          <FileUp size={18} />
          ファイルを選択
        </button>
      </div>

      {/* Metadata Card */}
      <section className="metadata-grid-card">
        <div className="card-title-row">
          <div className="card-title-group">
            <FileCheck2 size={18} />
            <h2>データ取込状況</h2>
          </div>
        </div>

        <div className="metadata-row">
          <span className="metadata-label">ファイル名</span>
          <strong className="metadata-value">{state.metadata?.sourceFileName ?? "未読み込み"}</strong>
        </div>
        <div className="metadata-row">
          <span className="metadata-label">取込件数</span>
          <strong className="metadata-value num-tabular">
            {state.metadata?.rowCount ? `${state.metadata.rowCount.toLocaleString("ja-JP")} 件` : "0 件"}
          </strong>
        </div>
        <div className="metadata-row">
          <span className="metadata-label">データ期間</span>
          <strong className="metadata-value">
            {state.metadata?.dateStart && state.metadata?.dateEnd
              ? `${formatDate(state.metadata.dateStart)} 〜 ${formatDate(state.metadata.dateEnd)}`
              : "-"}
          </strong>
        </div>
        <div className="metadata-row">
          <span className="metadata-label">集計月数 / 年数</span>
          <strong className="metadata-value">
            {state.metadata?.monthCount ?? 0} ヶ月 / {state.metadata?.yearCount ?? 0} 年
          </strong>
        </div>
        <div className="metadata-row">
          <span className="metadata-label">文字コード</span>
          <strong className="metadata-value">{state.metadata?.encoding ?? "-"}</strong>
        </div>
        <div className="metadata-row">
          <span className="metadata-label">最終取込日時</span>
          <strong className="metadata-value">
            {state.metadata?.importedAt ? new Date(state.metadata.importedAt).toLocaleString("ja-JP") : "-"}
          </strong>
        </div>
      </section>

      {state.transactions.length > 0 && (
        <button className="danger-button" type="button" onClick={() => onDelete()}>
          <Trash2 size={16} />
          端末内データをすべて削除
        </button>
      )}
    </section>
  );
}

/* ==========================================================================
   Confirm Dialog Modal
   ========================================================================== */

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
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {request.tone === "danger" ? (
              <ShieldAlert size={18} color="var(--danger)" />
            ) : (
              <AlertTriangle size={18} color="var(--warning)" />
            )}
            <span className="confirm-dialog-eyebrow">確認</span>
          </div>
          <h2 id="confirm-title">{request.title}</h2>
        </div>
        <p className="confirm-dialog-msg">{request.message}</p>
        <div className="confirm-dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className={request.tone === "danger" ? "danger-button solid" : "primary-button"}
            type="button"
            onClick={onConfirm}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Helper Functions
   ========================================================================== */

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

type RateStatus = "tentative" | "achieved" | "missed";

function isCurrentMonth(month: string): boolean {
  const now = new Date();
  return month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function rateStatus(rate: number, isTentative: boolean): RateStatus {
  if (isTentative) return "tentative";
  return rate >= 0.2 ? "achieved" : "missed";
}

function rateStatusLabel(status: RateStatus): string {
  switch (status) {
    case "tentative":
      return "当月途中";
    case "achieved":
      return "20%達成";
    case "missed":
      return "20%未達";
  }
}

function rateStatusTitle(status: RateStatus): string {
  switch (status) {
    case "tentative":
      return "当月途中（見込み計算）";
    case "achieved":
      return "貯蓄目標 20% 達成 🎉";
    case "missed":
      return "貯蓄目標 20% 未達";
  }
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
