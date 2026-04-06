"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, Area, ComposedChart, Cell,
} from "recharts";
import { TrendingUp, Award, AlertTriangle, BarChart2, Play, RefreshCw } from "lucide-react";
import { useBacktest, useAccuracy } from "../hooks/useBacktest";
import type { BacktestConfig, BacktestResult, AccuracyReport } from "../hooks/useBacktest";

// ── Helpers ───────────────────────────────────────────────────────────────────

const pct  = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const fmt2 = (v: number)        => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (v: number)        => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`;

function trendColor(t: string) {
  if (t === "improving")  return "text-emerald-400";
  if (t === "declining")  return "text-red-400";
  return "text-slate-400";
}

// ── Default backtest config (XAUUSD, last 90 days) ────────────────────────────

function defaultConfig(): BacktestConfig {
  const end   = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  return {
    symbol:          "XAUUSD",
    start_date:      start.toISOString(),
    end_date:        end.toISOString(),
    initial_capital: 10000,
    risk_per_trade:  0.02,
    min_confidence:  0.6,
    signal_types:    ["BUY", "SELL"],
  };
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color = "slate" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  const ring: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    red:     "border-red-500/20 bg-red-500/5",
    amber:   "border-amber-500/20 bg-amber-500/5",
    slate:   "border-slate-700 bg-slate-900/60",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${ring[color] ?? ring.slate}`}>
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold font-mono text-slate-100 mt-0.5">{value}</p>
      {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Equity curve chart ────────────────────────────────────────────────────────

function EquityChart({ data, initial }: { data: { date: string; equity: number }[]; initial: number }) {
  const unique = data.filter((d, i, arr) => i === 0 || d.date !== arr[i - 1].date);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-semibold text-slate-400 mb-3">Equity Curve</p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={unique} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false}
            interval={Math.max(1, Math.floor(unique.length / 6))} />
          <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false}
            tickFormatter={fmtK} width={52} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: unknown) => [`$${fmt2(Number(v) || 0)}`, "Equity"]} />
          <ReferenceLine y={initial} stroke="#475569" strokeDasharray="4 2" strokeOpacity={0.5} />
          <Area dataKey="equity" fill="url(#eqGrad)" stroke="none" />
          <Line dataKey="equity" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Monthly returns chart ─────────────────────────────────────────────────────

function MonthlyChart({ data }: { data: { month: string; return_pct: number }[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-semibold text-slate-400 mb-3">Monthly Returns (%)</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} width={40} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: unknown) => [`${(Number(v) || 0).toFixed(2)}%`, "Return"]} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="return_pct" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.return_pct >= 0 ? "#10b981" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Confidence calibration ────────────────────────────────────────────────────

function ConfCalibChart({ byBand }: { byBand: Record<string, number> }) {
  const BAND_MID: Record<string, number> = {
    "<0.6":    0.575, "0.6-0.7": 0.65,
    "0.7-0.8": 0.75,  "0.8-0.9": 0.85, "0.9+": 0.92,
  };
  const points = Object.entries(byBand).map(([band, wr]) => ({
    confidence: BAND_MID[band] ?? parseFloat(band),
    win_rate:   wr,
    band,
  }));
  const ideal = [
    { confidence: 0.55, ideal: 0.55 },
    { confidence: 0.95, ideal: 0.95 },
  ];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-semibold text-slate-400 mb-3">Confidence Calibration</p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis type="number" dataKey="confidence" domain={[0.5, 1]}
            tick={{ fill: "#475569", fontSize: 10 }} tickLine={false}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
          <YAxis type="number" dataKey="win_rate" domain={[0, 1]}
            tick={{ fill: "#475569", fontSize: 10 }} tickLine={false}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={40} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: unknown, name: unknown) => [`${((Number(v) || 0) * 100).toFixed(1)}%`, name === "ideal" ? "Ideal" : "Actual"]} />
          <Line data={ideal} dataKey="ideal" stroke="#475569" strokeDasharray="4 2"
            dot={false} strokeWidth={1} isAnimationActive={false} name="Ideal" />
          <Scatter data={points} dataKey="win_rate" fill="#f59e0b" name="Actual" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Symbol radar chart ────────────────────────────────────────────────────────

function SymbolRadar({ bySymbol }: { bySymbol: Record<string, { win_rate: number; total: number }> }) {
  const data = Object.entries(bySymbol)
    .filter(([, s]) => s.total >= 3)
    .map(([sym, s]) => ({ symbol: sym.replace("USD", ""), win_rate: Math.round(s.win_rate * 100) }));

  if (data.length < 2) return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex items-center justify-center h-full">
      <p className="text-xs text-slate-600">Not enough symbols for radar</p>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-semibold text-slate-400 mb-3">Win Rate by Symbol</p>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 16 }}>
          <PolarGrid stroke="#1e293b" />
          <PolarAngleAxis dataKey="symbol" tick={{ fill: "#64748b", fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 9 }} tickCount={4} />
          <Radar dataKey="win_rate" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: unknown) => [`${Number(v) || 0}%`, "Win Rate"]} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Confluence vs single source bar chart ──────────────────────────────────────

function ConfluenceChart({ confluence, single, bySession }: {
  confluence: number; single: number; bySession: Record<string, number>;
}) {
  const sourceData = [
    { name: "Confluence",    win_rate: Math.round(confluence * 100) },
    { name: "Single Source", win_rate: Math.round(single * 100) },
  ];
  const sessionData = Object.entries(bySession).map(([k, v]) => ({
    name: k.charAt(0).toUpperCase() + k.slice(1),
    win_rate: Math.round(v * 100),
  }));
  const combined = [...sourceData, ...sessionData];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-semibold text-slate-400 mb-3">Win Rate by Source & Session</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={combined} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 10 }} tickLine={false}
            tickFormatter={(v) => `${v}%`} width={36} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: unknown) => [`${Number(v) || 0}%`, "Win Rate"]} />
          <ReferenceLine y={50} stroke="#475569" strokeDasharray="4 2" />
          <Bar dataKey="win_rate" radius={[3, 3, 0, 0]}>
            {combined.map((d, i) => (
              <Cell key={i} fill={d.win_rate >= 50 ? "#10b981" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Backtest panel ────────────────────────────────────────────────────────────

const SYMBOLS = ["XAUUSD", "XAGUSD", "USOIL", "UKOIL", "NATGAS"];

function BacktestPanel() {
  const { result, loading, error, run, reset } = useBacktest();
  const [cfg, setCfg] = useState<BacktestConfig>(defaultConfig());

  function patch(p: Partial<BacktestConfig>) { setCfg(prev => ({ ...prev, ...p })); }

  function toDateInput(iso: string) {
    try { return new Date(iso).toISOString().slice(0, 10); } catch { return ""; }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
      <p className="text-xs font-semibold text-slate-400">Backtest Configuration</p>

      {/* Config form */}
      <div className="flex flex-wrap gap-2">
        <select value={cfg.symbol} onChange={e => patch({ symbol: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50">
          {SYMBOLS.map(s => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={toDateInput(cfg.start_date)}
          onChange={e => patch({ start_date: new Date(e.target.value).toISOString() })}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50" />
        <input type="date" value={toDateInput(cfg.end_date)}
          onChange={e => patch({ end_date: new Date(e.target.value).toISOString() })}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Capital</span>
          <input type="number" value={cfg.initial_capital} min={100}
            onChange={e => patch({ initial_capital: Number(e.target.value) })}
            className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Risk %</span>
          <input type="number" value={cfg.risk_per_trade * 100} min={0.1} max={10} step={0.1}
            onChange={e => patch({ risk_per_trade: Number(e.target.value) / 100 })}
            className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Min conf</span>
          <input type="number" value={cfg.min_confidence} min={0} max={1} step={0.05}
            onChange={e => patch({ min_confidence: Number(e.target.value) })}
            className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50" />
        </div>
        <button onClick={() => run(cfg)} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/15 disabled:opacity-50 transition-colors">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {loading ? "Running…" : "Run Backtest"}
        </button>
        {result && (
          <button onClick={reset}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 transition-colors">
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Results */}
      {result && <BacktestResults result={result} config={cfg} />}
    </div>
  );
}

function BacktestResults({ result, config }: { result: BacktestResult; config: BacktestConfig }) {
  return (
    <div className="space-y-4">
      {result.is_mock && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Using mock data — insufficient real settled trades for {config.symbol}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KPICard label="Trades"         value={String(result.total_trades)}
          sub={`${result.winning_trades}W / ${result.losing_trades}L`} />
        <KPICard label="Win Rate"       value={pct(result.win_rate)}
          color={result.win_rate >= 0.5 ? "emerald" : "red"} />
        <KPICard label="Net P&L"        value={`$${fmt2(result.total_pnl)}`}
          sub={`${result.total_pnl_pct > 0 ? "+" : ""}${result.total_pnl_pct.toFixed(2)}%`}
          color={result.total_pnl >= 0 ? "emerald" : "red"} />
        <KPICard label="Max Drawdown"   value={`-${pct(result.max_drawdown)}`}
          color={result.max_drawdown < 0.1 ? "slate" : "red"} />
        <KPICard label="Sharpe Ratio"   value={result.sharpe_ratio.toFixed(2)}
          color={result.sharpe_ratio >= 1 ? "emerald" : "slate"} />
        <KPICard label="Profit Factor"  value={result.profit_factor.toFixed(2)}
          color={result.profit_factor >= 1.5 ? "emerald" : "slate"} />
        <KPICard label="Avg Win"        value={`$${fmt2(result.avg_win)}`}   color="emerald" />
        <KPICard label="Avg Loss"       value={`$${fmt2(Math.abs(result.avg_loss))}`} color="red" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {result.equity_curve.length > 1 && (
          <EquityChart data={result.equity_curve} initial={config.initial_capital} />
        )}
        {result.monthly_returns.length > 0 && (
          <MonthlyChart data={result.monthly_returns} />
        )}
      </div>

      {/* Trade log */}
      {result.trades.length > 0 && (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-left">
              <thead className="bg-slate-900/80 sticky top-0">
                <tr>
                  {["Date", "Type", "Conf", "Outcome", "R:R", "P&L"].map(h => (
                    <th key={h} className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.trades.slice(0, 50).map((t, i) => (
                  <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                    <td className="px-3 py-2 text-xs text-slate-500 font-mono">{t.date}</td>
                    <td className="px-3 py-2 text-xs font-bold">
                      <span className={t.type === "BUY" ? "text-emerald-400" : "text-red-400"}>{t.type}</span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-slate-300">{Math.round(t.confidence * 100)}%</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`font-medium ${t.outcome === "tp_hit" ? "text-emerald-400" : "text-red-400"}`}>
                        {t.outcome === "tp_hit" ? "TP Hit" : "SL Hit"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-slate-400">1:{t.rr.toFixed(1)}</td>
                    <td className={`px-3 py-2 text-xs font-mono font-bold ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.pnl >= 0 ? "+" : ""}${fmt2(t.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.trades.length > 50 && (
            <p className="px-3 py-2 text-xs text-slate-600 border-t border-slate-800">
              Showing 50 of {result.trades.length} trades
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Accuracy overview ─────────────────────────────────────────────────────────

function AccuracyOverview({ report }: { report: AccuracyReport }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KPICard label="Overall Win Rate" value={pct(report.overall_win_rate)}
        color={report.overall_win_rate >= 0.5 ? "emerald" : "red"}
        sub={`${report.total_closed} closed trades`} />
      <KPICard label="Confluence WR"    value={report.confluence_win_rate ? pct(report.confluence_win_rate) : "—"}
        color="amber" sub="TFT + SMC agree" />
      <KPICard label="Single Source WR" value={report.single_source_win_rate ? pct(report.single_source_win_rate) : "—"}
        sub="One indicator" />
      <KPICard label="Recent Trend"
        value={report.recent_trend.charAt(0).toUpperCase() + report.recent_trend.slice(1)}
        color={report.recent_trend === "improving" ? "emerald" : report.recent_trend === "declining" ? "red" : "slate"} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const { report, loading: accLoading, error: accError } = useAccuracy();
  const backtest = useBacktest();

  // Auto-run a default backtest on mount
  useEffect(() => {
    backtest.run(defaultConfig());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <TrendingUp className="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-100 leading-tight">Signal Performance</h1>
          <p className="text-xs text-slate-500">Backtest engine · accuracy analysis · equity simulation</p>
        </div>
      </div>

      {/* Accuracy section */}
      {accError ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">{accError}</div>
      ) : accLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 animate-pulse">
              <div className="h-3 w-20 rounded bg-slate-800 mb-2" />
              <div className="h-6 w-14 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      ) : report ? (
        <>
          {report.insufficient_data && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Insufficient real data for accuracy analysis. Stats will populate as signals settle.
            </div>
          )}
          <AccuracyOverview report={report} />

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ConfCalibChart   byBand={report.by_confidence_band} />
            <SymbolRadar      bySymbol={report.by_symbol} />
            <ConfluenceChart  confluence={report.confluence_win_rate}
              single={report.single_source_win_rate} bySession={report.by_session} />
          </div>
        </>
      ) : null}

      {/* Backtest section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-300">Backtest</h2>
        </div>
        <BacktestPanel />
      </div>
    </div>
  );
}
