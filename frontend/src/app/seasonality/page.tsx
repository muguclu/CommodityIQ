"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Thermometer, Loader2, AlertCircle, Play, ChevronDown } from "lucide-react";
import ExplainButton from "@/components/ui/ExplainButton";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, BarChart, Bar, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
  ComposedChart, Area, ReferenceArea,
} from "recharts";
import { useCommodityStore } from "@/lib/store";
import { runSeasonality, runYoY, runSeasonalSignals } from "@/lib/api";
import type { SeasonalityResult, YoYResult, YoYYearSummary, CommodityDataset, SeasonalSignalResult } from "@/lib/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPct(v: number, decimals = 1): string {
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(decimals) + "%";
}

function fmtDate(d: string, spanDays: number): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  if (spanDays > 730) return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getHeatmapColor(returnPct: number): string {
  const clamped = Math.max(-5, Math.min(5, returnPct * 100));
  if (clamped >= 0) {
    const i = Math.floor((clamped / 5) * 200);
    return `rgb(${55 + (200 - i)}, ${55 + i}, ${55})`;
  } else {
    const i = Math.floor((Math.abs(clamped) / 5) * 200);
    return `rgb(${55 + i}, ${55 + (200 - i)}, ${55})`;
  }
}

function cellTextColor(returnPct: number): string {
  return Math.abs(returnPct * 100) > 2 ? "#fff" : "#94a3b8";
}

// ── YoY helpers ───────────────────────────────────────────────────────────────

const YOY_COLORS = ["#f59e0b", "#ffffff", "#3b82f6", "#a78bfa", "#6b7280", "#94a3b8", "#64748b"];
const MONTH_TICKS = [1, 22, 42, 63, 83, 104, 124, 145, 165, 185, 206, 226];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function tradingDayToMonth(day: number): string {
  let idx = 0;
  for (let i = MONTH_TICKS.length - 1; i >= 0; i--) {
    if (day >= MONTH_TICKS[i]) { idx = i; break; }
  }
  return MONTH_NAMES[idx] ?? "";
}

function YoYSection({ ds }: { ds: CommodityDataset }) {
  const [yrsToShow, setYrsToShow] = useState<number>(5);
  const [normalize, setNormalize] = useState(true);
  const [showBand, setShowBand]   = useState(true);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<YoYResult | null>(null);

  const run = useCallback(async (yrs: number, norm: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await runYoY({
        name: ds.name,
        dates: ds.records.map(r => r.date),
        values: ds.records.map(r => r.close),
        years_to_show: yrs,
        normalize: norm,
      });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "YoY analysis failed.");
    } finally {
      setLoading(false);
    }
  }, [ds]);

  const handleYrs = (y: number) => { setYrsToShow(y); run(y, normalize); };
  const handleNorm = (n: boolean) => { setNormalize(n); run(yrsToShow, n); };

  // sorted years newest-first for color assignment
  const sortedYears = useMemo(() =>
    result ? Object.keys(result.years_data).map(Number).sort((a, b) => b - a) : []
  , [result]);

  // flat chart data: { trading_day, mean, upper, lower, y2024, y2025, ... }
  const chartData = useMemo(() => {
    if (!result) return [];
    const dayMap = new Map<number, Record<string, number>>();
    result.mean_band.forEach(mb => {
      dayMap.set(mb.trading_day, {
        trading_day: mb.trading_day,
        mean: mb.mean, upper: mb.upper, lower: mb.lower,
      });
    });
    Object.entries(result.years_data).forEach(([year, records]) => {
      records.forEach(r => {
        const existing = dayMap.get(r.trading_day) ?? { trading_day: r.trading_day };
        dayMap.set(r.trading_day, { ...existing, [`y${year}`]: r.value });
      });
    });
    return Array.from(dayMap.values()).sort((a, b) => a.trading_day - b.trading_day);
  }, [result]);

  // insight: compare current year at its last trading day vs mean band at same day
  const insight = useMemo(() => {
    if (!result || sortedYears.length < 2) return null;
    const cy = result.current_year;
    const cyRecords = result.years_data[String(cy)];
    if (!cyRecords || cyRecords.length === 0) return null;
    const lastDay  = cyRecords[cyRecords.length - 1].trading_day;
    const lastVal  = cyRecords[cyRecords.length - 1].value;
    const bandPt   = result.mean_band.find(b => b.trading_day === lastDay)
                  ?? result.mean_band.reduce((prev, cur) =>
                       Math.abs(cur.trading_day - lastDay) < Math.abs(prev.trading_day - lastDay) ? cur : prev
                     , result.mean_band[0]);
    if (!bandPt) return null;
    const diff = ((lastVal - bandPt.mean) / bandPt.mean) * 100;
    const nextMonthIdx = Math.min(11, MONTH_TICKS.findIndex(t => t > lastDay));
    const nextMonths   = MONTH_NAMES.slice(nextMonthIdx, nextMonthIdx + 3).join("–");
    // avg return for those next months from mean_band
    const nextBand  = result.mean_band.filter(b => b.trading_day > lastDay && b.trading_day <= lastDay + 63);
    const avgNext   = nextBand.length > 1
      ? ((nextBand[nextBand.length - 1].mean / nextBand[0].mean) - 1) * 100
      : 0;
    return { cy, diff, nextMonths, avgNext, lastDay };
  }, [result, sortedYears]);

  const summaries: YoYYearSummary[] = useMemo(() =>
    result ? [...result.year_summaries].sort((a, b) => b.year - a.year) : []
  , [result]);

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5 space-y-4">
      {/* Header + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-commodity-text">Year-over-Year Comparison</h3>
          <p className="text-[11px] text-commodity-muted">Overlay each calendar year on a common trading-day axis</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Year pills */}
          <div className="flex items-center gap-1 bg-commodity-panel rounded-lg p-1">
            {[3, 5, 10].map(y => (
              <button key={y}
                onClick={() => handleYrs(y)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  yrsToShow === y
                    ? "bg-teal-500 text-slate-900"
                    : "text-commodity-muted hover:text-commodity-text"
                }`}>{y === 10 ? "All" : `${y}Y`}</button>
            ))}
          </div>
          {/* Normalize toggle */}
          <button
            onClick={() => handleNorm(!normalize)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              normalize
                ? "bg-teal-500/15 border-teal-500/40 text-teal-400"
                : "border-commodity-border text-commodity-muted hover:text-commodity-text"
            }`}>
            <span className={`w-2 h-2 rounded-full ${normalize ? "bg-teal-400" : "bg-commodity-muted/40"}`}/>
            Index to 100
          </button>
          {/* Band toggle */}
          <button
            onClick={() => setShowBand(b => !b)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showBand
                ? "bg-slate-500/15 border-slate-500/40 text-slate-300"
                : "border-commodity-border text-commodity-muted hover:text-commodity-text"
            }`}>
            <span className={`w-2 h-2 rounded-full ${showBand ? "bg-slate-400" : "bg-commodity-muted/40"}`}/>
            Mean band
          </button>
          {/* Run button */}
          <button
            onClick={() => run(yrsToShow, normalize)}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-900 font-semibold text-xs disabled:opacity-40 transition-colors">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run YoY
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
          <span className="text-sm text-commodity-muted">Computing year-over-year overlay…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {/* Chart */}
      {result && !loading && (
        <>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="trading_day"
                type="number"
                domain={[1, 252]}
                ticks={MONTH_TICKS}
                tickFormatter={(v: number) => tradingDayToMonth(v)}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={52}
                tickFormatter={(v: number) => normalize ? v.toFixed(0) : "$" + v.toFixed(0)}
              />
              {normalize && <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 2" />}
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                labelFormatter={(day: unknown) => { const d = day as number; return `Day ${d} (~${tradingDayToMonth(d)})`; }}
                formatter={(v: unknown, name: unknown) => {
                  const val = v as number;
                  const nm  = name as string;
                  if (nm === "band") return [null, null];
                  if (nm === "mean") return [val?.toFixed(2), "Avg"];
                  const yr = nm.replace("y", "");
                  return [normalize ? val?.toFixed(2) : "$" + val?.toFixed(2), yr];
                }}
              />
              {/* Mean band area */}
              {showBand && (
                <Area dataKey="upper" stroke="none" fill="#64748b" fillOpacity={0.12} legendType="none" />
              )}
              {showBand && (
                <Area dataKey="lower" stroke="none" fill="#0f172a" fillOpacity={1} legendType="none" />
              )}
              {/* Mean line */}
              {showBand && (
                <Line dataKey="mean" stroke="#475569" strokeWidth={1} strokeDasharray="4 2" dot={false} legendType="none" />
              )}
              {/* Year lines — oldest to newest so current year renders on top */}
              {[...sortedYears].reverse().map((yr, i) => {
                const colorIdx = sortedYears.indexOf(yr); // 0 = current year
                const isCurrent = yr === result.current_year;
                return (
                  <Line
                    key={yr}
                    dataKey={`y${yr}`}
                    name={`y${yr}`}
                    stroke={YOY_COLORS[colorIdx] ?? "#64748b"}
                    strokeWidth={isCurrent ? 2.5 : colorIdx === 1 ? 1.5 : 1}
                    dot={false}
                    connectNulls
                    legendType="line"
                  />
                );
              })}
              <Legend
                formatter={(value: string) => {
                  const yr = value.replace("y", "");
                  const isCurrent = Number(yr) === result.current_year;
                  return <span style={{ fontSize: 11, fontWeight: isCurrent ? 700 : 400, color: isCurrent ? "#f59e0b" : "#94a3b8" }}>{yr}</span>;
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Year Performance Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono border-collapse" style={{ minWidth: 560 }}>
              <thead>
                <tr className="border-b border-commodity-border">
                  {["Year", "YTD Return", "Max", "Min", "Final", "Days", "Status"].map(h => (
                    <th key={h} className="text-left text-commodity-muted font-normal px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaries.map((s, i) => {
                  const isCurrent = s.year === result.current_year;
                  const colorIdx  = sortedYears.indexOf(s.year);
                  const lineColor = YOY_COLORS[colorIdx] ?? "#64748b";
                  return (
                    <tr key={s.year} className={isCurrent ? "bg-amber-500/5" : i % 2 === 0 ? "" : "bg-commodity-panel/30"}>
                      <td className="px-3 py-2 font-sans font-semibold" style={{ color: lineColor }}>{s.year}</td>
                      <td className={`px-3 py-2 font-semibold ${s.ytd_return >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(s.ytd_return)}
                      </td>
                      <td className="px-3 py-2 text-emerald-400/80">{normalize ? s.max_value.toFixed(1) : "$" + s.max_value.toFixed(1)}</td>
                      <td className="px-3 py-2 text-red-400/80">{normalize ? s.min_value.toFixed(1) : "$" + s.min_value.toFixed(1)}</td>
                      <td className="px-3 py-2 text-commodity-text">{normalize ? s.final_value.toFixed(2) : "$" + s.final_value.toFixed(2)}</td>
                      <td className="px-3 py-2 text-commodity-muted">{s.trading_days}</td>
                      <td className="px-3 py-2">
                        {isCurrent
                          ? <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">In Progress</span>
                          : <span className="px-2 py-0.5 rounded text-[10px] text-commodity-muted/60 border border-commodity-border">Complete</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Insight Banner */}
          {insight && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-5 py-4 space-y-1.5">
              <p className="text-[11px] text-commodity-muted uppercase tracking-wider">Current Year vs Historical Average</p>
              <p className={`text-sm font-medium ${
                insight.diff >= 0 ? "text-emerald-400" : "text-red-400"
              }`}>
                {insight.cy} is tracking{" "}
                <strong>{Math.abs(insight.diff).toFixed(1)}%</strong>{" "}
                {insight.diff >= 0 ? "ABOVE" : "BELOW"} the {sortedYears.length}-year average at Day {insight.lastDay}.
              </p>
              {Math.abs(insight.avgNext) > 0.01 && (
                <p className="text-xs text-commodity-muted">
                  Historically, the next 3 months ({insight.nextMonths}) have averaged{" "}
                  <span className={insight.avgNext >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {fmtPct(insight.avgNext / 100, 2)}
                  </span>{" "}
                  return based on the mean path.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StrengthBadge({ result }: { result: SeasonalityResult }) {
  const s = result.seasonal_strength;
  const label = result.seasonal_strength_label;
  const color = label === "Strong" ? "text-emerald-400" : label === "Moderate" ? "text-amber-400" : "text-red-400";
  const ring  = label === "Strong" ? "border-emerald-500/40" : label === "Moderate" ? "border-amber-500/40" : "border-red-500/40";
  const bg    = label === "Strong" ? "bg-emerald-500/10" : label === "Moderate" ? "bg-amber-500/10" : "bg-red-500/10";
  const text  = label === "Strong"
    ? "This commodity exhibits strong seasonal patterns. Trading seasonal trends may be profitable."
    : label === "Moderate"
    ? "Some seasonal patterns exist but are not dominant. Use with other indicators."
    : "Seasonality is weak. Price movements are driven primarily by non-seasonal factors.";

  return (
    <div className={`flex items-center gap-6 p-5 rounded-xl border ${ring} ${bg}`}>
      <div>
        <p className="text-[11px] text-commodity-muted uppercase tracking-wider mb-1">Seasonal Strength Index</p>
        <p className="text-[11px] text-commodity-muted">{result.period_analyzed} · {result.total_years}y</p>
      </div>
      <div className={`text-5xl font-bold font-mono ${color} shrink-0`}>{s.toFixed(2)}</div>
      <div className={`px-3 py-1 rounded-lg font-semibold text-sm ${color} border ${ring} shrink-0`}>{label}</div>
      <p className="text-sm text-commodity-muted flex-1">{text}</p>
    </div>
  );
}

function STLCharts({ result }: { result: SeasonalityResult }) {
  const { dates, observed, trend, seasonal, residual } = result.decomposition;
  const spanDays = useMemo(() => {
    if (dates.length < 2) return 365;
    return (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86_400_000;
  }, [dates]);

  const stdResid = useMemo(() => {
    const vals = residual.filter((v): v is number => v != null);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    return Math.sqrt(variance);
  }, [residual]);

  const chartData = useMemo(() =>
    dates.map((d, i) => ({
      date: d,
      observed: observed[i],
      trend:    trend[i],
      seasonal: seasonal[i],
      residual: residual[i],
      extreme:  residual[i] != null && Math.abs(residual[i]!) > 2 * stdResid ? residual[i] : null,
    })), [dates, observed, trend, seasonal, residual, stdResid]);

  const step = Math.max(1, Math.floor(chartData.length / 80));
  const thinData = chartData.filter((_, i) => i % step === 0);
  const tick = { fontSize: 9, fill: "#64748b" };
  const fmt = (v: string) => fmtDate(v, spanDays);

  const panels = [
    { key: "observed", label: "Observed (Price)",    color: "#94a3b8", showRef: false },
    { key: "trend",    label: "Trend",               color: "#3b82f6", showRef: false },
    { key: "seasonal", label: "Seasonal Component",  color: "#f59e0b", showRef: true  },
    { key: "residual", label: "Residual (Noise)",    color: "#64748b", showRef: true  },
  ] as const;

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-0.5">Seasonal Decomposition (STL)</h3>
      <p className="text-[11px] text-commodity-muted mb-4">Breaking down price into trend, seasonal, and residual components</p>
      <div className="space-y-1">
        {panels.map(({ key, label, color, showRef }) => (
          <div key={key}>
            <p className="text-[10px] text-commodity-muted uppercase tracking-wider px-1 mb-0.5">{label}</p>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={thinData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmt} tick={tick} axisLine={false} tickLine={false} minTickGap={60} />
                <YAxis tick={tick} axisLine={false} tickLine={false} width={58}
                  tickFormatter={(v: number) => key === "observed" || key === "trend" ? "$" + v.toFixed(0) : v.toFixed(3)} />
                {showRef && <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 2" />}
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(v: unknown) => { const n = v as number; return [key === "observed" || key === "trend" ? "$" + n?.toFixed(2) : n?.toFixed(4), label]; }}
                />
                <Line dataKey={key} stroke={color} strokeWidth={1.5} dot={false} connectNulls />
                {key === "residual" && (
                  <Line dataKey="extreme" stroke="#ef4444" strokeWidth={0} dot={{ r: 2, fill: "#ef4444" }} connectNulls={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyHeatmap({ result }: { result: SeasonalityResult }) {
  const { years, months, values } = result.monthly_matrix;
  const monthlyStats = result.monthly_stats;

  const yearTotals = useMemo(() =>
    values.map(row => {
      const valid = row.filter((v): v is number => v != null);
      if (valid.length === 0) return null;
      return valid.reduce((a, b) => (1 + a) * (1 + b) - 1, 0);
    }), [values]);

  const colAvgs = useMemo(() =>
    months.map((_, mi) => {
      const vals = values.map(row => row[mi]).filter((v): v is number => v != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }), [months, values]);

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-0.5">Monthly Return Heatmap</h3>
      <p className="text-[11px] text-commodity-muted mb-4">Average return by month and year — green = gains, red = losses</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono border-collapse" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              <th className="text-left text-commodity-muted font-normal px-2 py-1.5 w-14">Year</th>
              {months.map(m => (
                <th key={m} className="text-center text-commodity-muted font-normal px-0.5 py-1.5 w-12">{m}</th>
              ))}
              <th className="text-center text-commodity-muted font-normal px-2 py-1.5 w-16">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year, yi) => (
              <tr key={year}>
                <td className="text-commodity-muted px-2 py-0.5 font-sans text-[11px]">{year}</td>
                {values[yi].map((v, mi) => (
                  <td key={mi} className="px-0.5 py-0.5">
                    {v != null ? (
                      <div
                        className="rounded text-center leading-none py-1.5"
                        style={{ backgroundColor: getHeatmapColor(v), color: cellTextColor(v), minWidth: 42 }}
                      >
                        {fmtPct(v, 1)}
                      </div>
                    ) : (
                      <div className="rounded text-center leading-none py-1.5 text-commodity-muted/30" style={{ minWidth: 42 }}>—</div>
                    )}
                  </td>
                ))}
                <td className="px-1 py-0.5">
                  {yearTotals[yi] != null ? (
                    <div
                      className="rounded text-center leading-none py-1.5 font-semibold"
                      style={{ backgroundColor: getHeatmapColor(yearTotals[yi]!), color: cellTextColor(yearTotals[yi]!), minWidth: 46 }}
                    >
                      {fmtPct(yearTotals[yi]!, 1)}
                    </div>
                  ) : <div className="text-center text-commodity-muted/30">—</div>}
                </td>
              </tr>
            ))}
            {/* Average row */}
            <tr className="border-t border-commodity-border">
              <td className="text-commodity-text font-semibold px-2 py-1 font-sans text-[11px]">Avg</td>
              {colAvgs.map((v, mi) => (
                <td key={mi} className="px-0.5 py-1">
                  {v != null ? (
                    <div
                      className="rounded text-center leading-none py-2 font-bold border border-white/10"
                      style={{ backgroundColor: getHeatmapColor(v), color: cellTextColor(v), minWidth: 42 }}
                    >
                      {fmtPct(v, 1)}
                    </div>
                  ) : <div className="text-center text-commodity-muted/30">—</div>}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
        {/* Month stats below */}
        <div className="mt-3 flex flex-wrap gap-3">
          {monthlyStats.map(m => (
            <div key={m.month} className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className="text-commodity-muted">{m.month_name}</span>
              <span className={m.mean_return >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtPct(m.mean_return, 1)}</span>
              <span className="text-commodity-muted/50">({Math.round(m.positive_pct * 100)}%↑)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RadarAndDow({ result }: { result: SeasonalityResult }) {
  const radarData = result.monthly_stats.map(m => ({
    month: m.month_name,
    meanReturn: parseFloat((m.mean_return * 100).toFixed(2)),
    positivePct: parseFloat((m.positive_pct * 100).toFixed(1)),
  }));

  const dowData = result.day_of_week.map(d => ({
    name: d.day_name,
    mean: parseFloat((d.mean_return * 100).toFixed(3)),
    std:  parseFloat((d.std_return * 100).toFixed(3)),
    pos:  parseFloat((d.positive_pct * 100).toFixed(1)),
  }));

  const totalDays = result.day_of_week.reduce((a, b) => a + b.count, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Radar */}
      <div className="lg:col-span-3 bg-commodity-card border border-commodity-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-commodity-text mb-0.5">Seasonal Pattern — Monthly</h3>
        <p className="text-[11px] text-commodity-muted mb-3">Shape reveals which months are typically strong or weak</p>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <PolarRadiusAxis angle={90} tick={{ fontSize: 9, fill: "#475569" }} tickCount={4} />
            <Radar name="Mean Return (%)" dataKey="meanReturn" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} />
            <Radar name="% Positive" dataKey="positivePct" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
              formatter={(v: unknown, name: unknown) => { const n = v as number; const s = name as string; return [s === "Mean Return (%)" ? fmtPct(n / 100) : n.toFixed(1) + "% of years", s]; }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {/* DoW */}
      <div className="lg:col-span-2 bg-commodity-card border border-commodity-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-commodity-text mb-0.5">Day-of-Week Effect</h3>
        <p className="text-[11px] text-commodity-muted mb-3">Mean daily return by weekday</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dowData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={52}
              tickFormatter={(v: number) => v.toFixed(3) + "%"} />
            <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 2" />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
              formatter={(v: unknown, name: unknown) => [(v as number).toFixed(4) + "%", name as string]}
            />
            <Bar dataKey="mean" radius={[4, 4, 0, 0]}>
              {dowData.map((d, i) => (
                <Cell key={i} fill={d.mean >= 0 ? "#10b981" : "#ef4444"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-commodity-muted mt-2 text-center">Based on {totalDays.toLocaleString()} trading days</p>
      </div>
    </div>
  );
}

function Interpretation({ result }: { result: SeasonalityResult }) {
  const sorted = [...result.monthly_stats].sort((a, b) => b.mean_return - a.mean_return);
  const top3    = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3).reverse();
  const bestDow = [...result.day_of_week].sort((a, b) => b.mean_return - a.mean_return)[0];
  const strongestMonth = top3[0];

  return (
    <div className="bg-teal-500/5 border border-teal-500/20 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-3">Seasonality Interpretation</h3>
      <ul className="space-y-2 text-sm text-commodity-muted">
        <li className="flex items-start gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400/60 shrink-0 mt-1.5" />
          <span>
            Seasonality analysis over <strong className="text-commodity-text">{result.total_years}</strong> years
            of <strong className="text-commodity-text">{result.dataset_name}</strong> data reveals{" "}
            <strong className="text-commodity-text">{result.seasonal_strength_label.toLowerCase()}</strong> seasonal
            patterns (strength: <strong className="text-commodity-text">{result.seasonal_strength.toFixed(2)}</strong>).
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 shrink-0 mt-1.5" />
          <span>
            Historically strongest months:{" "}
            {top3.map((m, i) => (
              <span key={m.month}>
                <strong className="text-emerald-400">{m.month_name}</strong>
                <span className="text-emerald-400/70 font-mono text-xs"> ({fmtPct(m.mean_return)})</span>
                {i < 2 ? ", " : ""}
              </span>
            ))}.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400/60 shrink-0 mt-1.5" />
          <span>
            Historically weakest months:{" "}
            {bottom3.map((m, i) => (
              <span key={m.month}>
                <strong className="text-red-400">{m.month_name}</strong>
                <span className="text-red-400/70 font-mono text-xs"> ({fmtPct(m.mean_return)})</span>
                {i < 2 ? ", " : ""}
              </span>
            ))}.
          </span>
        </li>
        {bestDow && (
          <li className="flex items-start gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0 mt-1.5" />
            <span>
              Best day of the week:{" "}
              <strong className="text-amber-400">{bestDow.day_name}</strong>
              <span className="text-commodity-muted font-mono text-xs"> (avg: {fmtPct(bestDow.mean_return, 3)})</span>.
            </span>
          </li>
        )}
        {strongestMonth && (
          <li className="flex items-start gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400/60 shrink-0 mt-1.5" />
            <span>
              <strong className="text-commodity-text">{strongestMonth.month_name}</strong> has been positive{" "}
              <strong className="text-emerald-400">{Math.round(strongestMonth.positive_pct * 100)}%</strong> of the time
              over the last <strong className="text-commodity-text">{result.total_years}</strong> years.
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Signals Section ──────────────────────────────────────────────────────────

type MetricRow = {
  label: string;
  seasonal: string;
  buyhold: string;
  adv: number | null;
  fmtAdv: string;
  goodIfPos: boolean | null;
};

function SignalsSection({ ds }: { ds: CommodityDataset }) {
  const [posThresh, setPosThresh] = useState(0.60);
  const [negThresh, setNegThresh] = useState(0.40);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<SeasonalSignalResult | null>(null);

  const run = useCallback(async (pos: number, neg: number) => {
    setLoading(true); setError(null);
    try {
      const r = await runSeasonalSignals({
        name: ds.name,
        dates:  ds.records.map(r => r.date),
        values: ds.records.map(r => r.close),
        positive_threshold: pos,
        negative_threshold: neg,
      });
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Signal analysis failed.");
    } finally {
      setLoading(false);
    }
  }, [ds]);

  const equityData = useMemo(() => {
    if (!result) return [];
    return result.equity_curves.dates.map((d, i) => ({
      date: d,
      seasonal: result.equity_curves.seasonal_strategy[i],
      buyhold:  result.equity_curves.buy_and_hold[i],
    }));
  }, [result]);

  const strongRanges = useMemo(() => {
    if (!result || result.strong_months.length === 0) return [];
    const dates = result.equity_curves.dates;
    const ranges: { x1: string; x2: string }[] = [];
    let inRange = false;
    let rangeStart = "";
    for (let i = 0; i < dates.length; i++) {
      const month = new Date(dates[i]).getMonth() + 1;
      const isStrong = result.strong_months.includes(month);
      if (isStrong && !inRange)         { inRange = true;  rangeStart = dates[i]; }
      else if (!isStrong && inRange)    { inRange = false; ranges.push({ x1: rangeStart, x2: dates[i] }); }
    }
    if (inRange && rangeStart && dates.length > 0) ranges.push({ x1: rangeStart, x2: dates[dates.length - 1] });
    return ranges;
  }, [result]);

  const metricRows = useMemo((): MetricRow[] => {
    const sm = result?.seasonal_metrics;
    const bm = result?.buyhold_metrics;
    if (!sm || !bm) return [];
    const sgn = (v: number) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
    const rat  = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
    return [
      { label: "Total Return",          seasonal: fmtPct(sm.total_return),      buyhold: fmtPct(bm.total_return),      adv: sm.total_return - bm.total_return,                              fmtAdv: sgn(sm.total_return - bm.total_return),                             goodIfPos: true  },
      { label: "Annual Return",         seasonal: fmtPct(sm.annual_return),     buyhold: fmtPct(bm.annual_return),     adv: sm.annual_return - bm.annual_return,                            fmtAdv: sgn(sm.annual_return - bm.annual_return),                           goodIfPos: true  },
      { label: "Annual Volatility",     seasonal: fmtPct(sm.annual_volatility), buyhold: fmtPct(bm.annual_volatility), adv: bm.annual_volatility - sm.annual_volatility,                    fmtAdv: sgn(bm.annual_volatility - sm.annual_volatility),                   goodIfPos: true  },
      { label: "Sharpe Ratio",          seasonal: sm.sharpe_ratio.toFixed(2),   buyhold: bm.sharpe_ratio.toFixed(2),   adv: sm.sharpe_ratio - bm.sharpe_ratio,                              fmtAdv: rat(sm.sharpe_ratio - bm.sharpe_ratio),                             goodIfPos: true  },
      { label: "Sortino Ratio",         seasonal: sm.sortino_ratio.toFixed(2),  buyhold: bm.sortino_ratio.toFixed(2),  adv: sm.sortino_ratio - bm.sortino_ratio,                             fmtAdv: rat(sm.sortino_ratio - bm.sortino_ratio),                           goodIfPos: true  },
      { label: "Max Drawdown",          seasonal: fmtPct(sm.max_drawdown),      buyhold: fmtPct(bm.max_drawdown),      adv: sm.max_drawdown - bm.max_drawdown,                              fmtAdv: sgn(sm.max_drawdown - bm.max_drawdown),                             goodIfPos: true  },
      { label: "Win Rate (Monthly)",    seasonal: Math.round(sm.win_rate * 100) + "%", buyhold: Math.round(bm.win_rate * 100) + "%", adv: sm.win_rate - bm.win_rate,    fmtAdv: sgn(sm.win_rate - bm.win_rate),                                     goodIfPos: true  },
      { label: "Months Invested / Year", seasonal: `${sm.num_trades} of 12`,    buyhold: "12 of 12",                   adv: null,                                                           fmtAdv: "—",                                                                goodIfPos: null  },
    ];
  }, [result]);

  const MNAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mName  = (m: number) => MNAMES[m - 1] ?? "";

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-commodity-text">Seasonal Trading Signals</h3>
          <p className="text-[11px] text-commodity-muted">Month classification + simple seasonal strategy backtest</p>
        </div>
        <button onClick={() => run(posThresh, negThresh)} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs disabled:opacity-40 transition-colors">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Run Signal Analysis
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          <span className="text-sm text-commodity-muted">Classifying months &amp; backtesting strategy…</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {result && !loading && (
        <>
          {/* A — Month Signal Calendar */}
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
            {result.calendar_signals.map(sig => {
              const strong = sig.signal === "strong";
              const weak   = sig.signal === "weak";
              return (
                <div key={sig.month} className={`rounded-xl border p-2.5 flex flex-col gap-1 items-center text-center ${
                  strong ? "border-emerald-500/40 bg-emerald-500/8 shadow-sm shadow-emerald-500/10"
                         : weak ? "border-red-500/40 bg-red-500/8 shadow-sm shadow-red-500/10"
                                : "border-commodity-border bg-commodity-panel/40"
                }`}>
                  <p className="text-[11px] font-bold text-commodity-text">{sig.month_name}</p>
                  {strong && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">STRONG</span>}
                  {weak   && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">WEAK</span>}
                  {!strong && !weak && <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-700/40 text-commodity-muted/60 border border-commodity-border">NEUTRAL</span>}
                  <p className={`text-[10px] font-mono font-semibold ${sig.avg_return >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtPct(sig.avg_return, 1)}</p>
                  <p className="text-[9px] text-commodity-muted/60">{Math.round(sig.positive_pct * 100)}% pos</p>
                  <span className={`text-[8px] px-1 rounded ${ sig.confidence === "high" ? "text-emerald-400/60" : "text-amber-400/60" }`}>
                    {sig.confidence === "high" ? "High conf" : "Low conf"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* B — Backtest Chart */}
          <div>
            <h4 className="text-xs font-semibold text-commodity-text mb-0.5">Seasonal Strategy vs Buy &amp; Hold</h4>
            <p className="text-[11px] text-commodity-muted mb-3">Both indexed to 100. Amber = seasonal (invested only in strong months). Dashed = buy &amp; hold. Green shading = invested periods.</p>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={equityData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                {strongRanges.map((r, i) => <ReferenceArea key={i} x1={r.x1} x2={r.x2} fill="#10b981" fillOpacity={0.05} />)}
                <XAxis dataKey="date"
                  tickFormatter={(v: string) => { const d = new Date(v); return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }}
                  tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={70} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={52}
                  tickFormatter={(v: number) => v.toFixed(0)} />
                <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 2" />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(v: unknown) => String(v)}
                  formatter={(v: unknown, name: unknown) => [
                    (v as number).toFixed(2),
                    name === "seasonal" ? "Seasonal Strategy" : "Buy & Hold",
                  ]}
                />
                <Legend formatter={(value: string) => (
                  <span style={{ fontSize: 11, color: value === "seasonal" ? "#f59e0b" : "#e2e8f0" }}>
                    {value === "seasonal" ? "Seasonal Strategy" : "Buy & Hold"}
                  </span>
                )} />
                <Line dataKey="buyhold"  name="buyhold"  stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                <Line dataKey="seasonal" name="seasonal" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* C — Performance Comparison Table */}
          <div>
            <h4 className="text-xs font-semibold text-commodity-text mb-3">Performance Comparison</h4>
            <div className="overflow-x-auto rounded-xl border border-commodity-border">
              <table className="w-full text-[11px] border-collapse" style={{ minWidth: 480 }}>
                <thead>
                  <tr className="border-b border-commodity-border bg-commodity-panel/40">
                    <th className="text-left text-commodity-muted font-normal px-4 py-2.5">Metric</th>
                    <th className="text-right text-amber-400/80 font-semibold px-4 py-2.5">Seasonal</th>
                    <th className="text-right text-slate-300/80 font-semibold px-4 py-2.5">Buy &amp; Hold</th>
                    <th className="text-right text-commodity-muted font-normal px-4 py-2.5">Advantage</th>
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-commodity-panel/20"}>
                      <td className="px-4 py-2.5 text-commodity-muted font-sans">{row.label}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-amber-400">{row.seasonal}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-300">{row.buyhold}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {row.goodIfPos === null ? (
                          <span className="text-commodity-muted/40">{row.fmtAdv}</span>
                        ) : (row.adv! > 0) === row.goodIfPos ? (
                          <span className="text-emerald-400">{row.fmtAdv} ✓</span>
                        ) : (
                          <span className="text-red-400">{row.fmtAdv} ✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`mt-3 px-4 py-3 rounded-xl text-xs ${
              result.outperformance > 0
                ? "bg-emerald-500/5 border border-emerald-500/20 text-emerald-400"
                : "bg-red-500/5 border border-red-500/20 text-red-400"
            }`}>
              {result.outperformance > 0
                ? `Seasonal strategy outperformed Buy & Hold by ${fmtPct(result.outperformance)} with ${fmtPct(result.buyhold_metrics.annual_volatility - result.seasonal_metrics.annual_volatility)} less annualised volatility.`
                : `Buy & Hold outperformed by ${fmtPct(Math.abs(result.outperformance))}. Seasonal patterns may not be strong enough to justify a timing strategy for this asset.`
              }
            </div>
          </div>

          {/* D — Strategy Card + Threshold Controls */}
          <div className="bg-commodity-panel/40 border border-commodity-border rounded-xl p-4 space-y-4">
            <h4 className="text-xs font-semibold text-commodity-text">Strategy Rules</h4>
            <div className="space-y-1.5 text-xs text-commodity-muted">
              <p>
                <span className="text-emerald-400 font-medium">📈 LONG during: </span>
                {result.strong_months.length > 0 ? result.strong_months.map(mName).join(", ") : "(none — strategy stays flat)"}
              </p>
              <p><span className="text-slate-400 font-medium">💤 FLAT during: </span>all other months</p>
              <p className="text-commodity-muted/50">Rebalance: First trading day of each month</p>
            </div>
            <div className="border-t border-commodity-border pt-3 grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-[10px] text-commodity-muted uppercase tracking-wider mb-2">
                  Strong threshold: <span className="text-amber-400 font-mono">{Math.round(posThresh * 100)}%</span>
                </label>
                <input type="range" min={55} max={80} step={5}
                  value={Math.round(posThresh * 100)}
                  onChange={e => setPosThresh(Number(e.target.value) / 100)}
                  className="w-full accent-amber-500 h-1.5 rounded cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-commodity-muted/50 mt-0.5"><span>55%</span><span>80%</span></div>
              </div>
              <div>
                <label className="block text-[10px] text-commodity-muted uppercase tracking-wider mb-2">
                  Weak threshold: <span className="text-red-400 font-mono">{Math.round(negThresh * 100)}%</span>
                </label>
                <input type="range" min={20} max={45} step={5}
                  value={Math.round(negThresh * 100)}
                  onChange={e => setNegThresh(Number(e.target.value) / 100)}
                  className="w-full accent-red-500 h-1.5 rounded cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-commodity-muted/50 mt-0.5"><span>20%</span><span>45%</span></div>
              </div>
            </div>
            <button onClick={() => run(posThresh, negThresh)} disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-commodity-border hover:bg-slate-600 text-commodity-text text-xs font-medium transition-colors disabled:opacity-40">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Recalculate
            </button>
            <p className="text-[10px] text-commodity-muted/40 border-t border-commodity-border pt-2">
              ⚠ Past seasonal patterns do not guarantee future results. This is a simplified backtest without transaction costs, slippage, or taxes.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SeasonalityPage() {
  const { datasets } = useCommodityStore();
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<SeasonalityResult | null>(null);

  const ds = useMemo(() => datasets.find(d => d.id === selectedId), [datasets, selectedId]);

  const dateRange = useMemo(() => {
    if (!ds || ds.records.length < 2) return null;
    const first = ds.records[0].date;
    const last  = ds.records[ds.records.length - 1].date;
    const years = ((new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 86_400_000)).toFixed(1);
    return { first, last, years };
  }, [ds]);

  const handleRun = useCallback(async () => {
    if (!ds || ds.records.length < 2) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await runSeasonality({
        name:   ds.name,
        dates:  ds.records.map(r => r.date),
        values: ds.records.map(r => r.close),
        period: 252,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Seasonality analysis failed.");
    } finally {
      setIsLoading(false);
    }
  }, [ds]);

  return (
    <div className="p-6 md:p-8 animate-fade-in space-y-6 max-w-screen-2xl">

      {/* A — Config Panel */}
      <div className="bg-commodity-card border border-commodity-border rounded-xl p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Select Dataset</label>
            <div className="relative">
              <select
                value={selectedId}
                onChange={e => { setSelectedId(e.target.value); setResult(null); setError(null); }}
                className="w-full bg-[#0f172a] border border-commodity-border text-slate-100 text-sm rounded-lg px-3 py-2.5 appearance-none cursor-pointer hover:border-slate-500 transition-colors focus:outline-none focus:border-amber-500/50"
              >
                <option value="" className="bg-[#0f172a] text-slate-400">— choose a dataset —</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id} className="bg-[#0f172a] text-slate-100">{d.name} ({d.records.length} rows)</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-commodity-muted pointer-events-none" />
            </div>
          </div>

          {dateRange && (
            <div className="text-[11px] text-commodity-muted space-y-0.5">
              <p>Range: <span className="text-commodity-text font-mono">{dateRange.first}</span> → <span className="text-commodity-text font-mono">{dateRange.last}</span></p>
              <p><span className="text-commodity-text font-mono">{dateRange.years}</span> years of data</p>
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={!ds || isLoading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Seasonality Analysis
          </button>
        </div>
        <p className="text-[11px] text-commodity-muted/60 mt-3">
          Minimum 2 years of data recommended for reliable seasonal patterns.
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 bg-commodity-card border border-commodity-border rounded-xl">
          <Loader2 className="w-10 h-10 text-teal-400 animate-spin" />
          <p className="text-sm text-commodity-muted">Running STL decomposition…</p>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && !isLoading && (
        <>
          <StrengthBadge result={result} />
          <STLCharts result={result} />
          <MonthlyHeatmap result={result} />
          <YoYSection ds={ds!} />
          <RadarAndDow result={result} />
          <Interpretation result={result} />
          <ExplainButton
            analysisType="seasonality"
            resultsSummary={{
              dataset_name: result.dataset_name,
              seasonal_strength: result.seasonal_strength,
              seasonal_strength_label: result.seasonal_strength_label,
              total_years: result.total_years,
              top_months: result.monthly_stats
                .slice()
                .sort((a, b) => (b.mean_return ?? 0) - (a.mean_return ?? 0))
                .slice(0, 3)
                .map(m => ({ month: m.month_name, avg_return_pct: ((m.mean_return ?? 0) * 100).toFixed(2), positive_pct: ((m.positive_pct ?? 0) * 100).toFixed(1) })),
              worst_months: result.monthly_stats
                .slice()
                .sort((a, b) => (a.mean_return ?? 0) - (b.mean_return ?? 0))
                .slice(0, 3)
                .map(m => ({ month: m.month_name, avg_return_pct: ((m.mean_return ?? 0) * 100).toFixed(2), positive_pct: ((m.positive_pct ?? 0) * 100).toFixed(1) })),
            }}
            datasetNames={[result.dataset_name]}
          />
          <SignalsSection ds={ds!} />
        </>
      )}

      {/* Empty state */}
      {!result && !isLoading && !error && (
        <div className="flex flex-col items-center justify-center py-28 gap-4 text-center">
          <Thermometer className="w-14 h-14 text-commodity-muted/20" />
          <p className="text-base text-commodity-muted">Select a dataset to analyze seasonal patterns</p>
          <p className="text-sm text-commodity-muted/50">Tip: Works best with 3+ years of daily data</p>
        </div>
      )}
    </div>
  );
}
