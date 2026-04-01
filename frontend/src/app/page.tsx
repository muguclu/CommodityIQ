"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Database,
  TrendingUp,
  Sparkles,
  Target,
  Thermometer,
  Link2,
  Bot,
  ArrowRight,
  BarChart2,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useCommodityStore } from "@/lib/store";
import type { OHLCVRecord } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const DATASET_COLORS = [
  "#f59e0b", "#fbbf24", "#94a3b8", "#f97316",
  "#3b82f6", "#22c55e", "#a78bfa", "#ec4899",
];

const RANGE_PILLS = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "All"] as const;
type RangePill = (typeof RANGE_PILLS)[number];

const modules = [
  {
    label: "Data Hub",
    href: "/data",
    icon: Database,
    description: "Import, clean, and manage commodity datasets",
    status: "active" as const,
    color: "text-sky-400",
    iconBg: "bg-sky-500/10 border-sky-500/20",
  },
  {
    label: "Regression",
    href: "/regression",
    icon: TrendingUp,
    description: "OLS regression, multi-variate analysis, structural breaks",
    status: "coming-soon" as const,
    color: "text-violet-400",
    iconBg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    label: "Forecast",
    href: "/forecast",
    icon: Sparkles,
    description: "ARIMA, ETS, and linear trend forecasting with confidence bands",
    status: "coming-soon" as const,
    color: "text-amber-400",
    iconBg: "bg-amber-500/10 border-amber-500/20",
  },
  {
    label: "Scenario",
    href: "/scenario",
    icon: Target,
    description: "Monte Carlo simulation and what-if scenario modeling",
    status: "coming-soon" as const,
    color: "text-rose-400",
    iconBg: "bg-rose-500/10 border-rose-500/20",
  },
  {
    label: "Seasonality",
    href: "/seasonality",
    icon: Thermometer,
    description: "Seasonal decomposition, monthly heatmaps, YoY overlays",
    status: "coming-soon" as const,
    color: "text-teal-400",
    iconBg: "bg-teal-500/10 border-teal-500/20",
  },
  {
    label: "Correlation",
    href: "/correlation",
    icon: Link2,
    description: "Cross-asset correlation matrix, rolling correlation, Granger causality",
    status: "coming-soon" as const,
    color: "text-indigo-400",
    iconBg: "bg-indigo-500/10 border-indigo-500/20",
  },
  {
    label: "AI Chat",
    href: "/chat",
    icon: Bot,
    description: "Natural language interface to all analytics via Claude AI",
    status: "coming-soon" as const,
    color: "text-emerald-400",
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMinDate(range: RangePill): Date | null {
  const now = new Date();
  switch (range) {
    case "1M": { const d = new Date(now); d.setMonth(d.getMonth() - 1);       return d; }
    case "3M": { const d = new Date(now); d.setMonth(d.getMonth() - 3);       return d; }
    case "6M": { const d = new Date(now); d.setMonth(d.getMonth() - 6);       return d; }
    case "YTD": return new Date(now.getFullYear(), 0, 1);
    case "1Y": { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
    case "2Y": { const d = new Date(now); d.setFullYear(d.getFullYear() - 2); return d; }
    case "5Y": { const d = new Date(now); d.setFullYear(d.getFullYear() - 5); return d; }
    default:   return null;
  }
}

function filterRecords(records: OHLCVRecord[], range: RangePill): OHLCVRecord[] {
  if (range === "All") return records;
  const min = getMinDate(range);
  if (!min) return records;
  return records.filter((r) => new Date(r.date) >= min);
}

function fmtPriceFull(v: number, indexed: boolean): string {
  if (indexed) return v.toFixed(2);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAxisPrice(v: number, indexed: boolean): string {
  if (indexed) return v.toFixed(1);
  if (v >= 1_000) return "$" + (v / 1_000).toFixed(1) + "k";
  return "$" + v.toFixed(2);
}

function fmtAxisDate(dateStr: string, spanDays: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  if (spanDays > 730) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  if (spanDays > 180) return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

interface TooltipEntry { name: string; value: number; color: string; }

function ChartTooltip({
  active,
  payload,
  label,
  indexed,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  indexed: boolean;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div
      className="rounded-lg border border-slate-700 p-3 shadow-2xl text-xs min-w-[180px]"
      style={{ background: "#0f172a" }}
    >
      <p className="text-slate-400 font-mono mb-2 pb-1.5 border-b border-slate-700/60">{label}</p>
      {payload.map((e) => (
        <div key={e.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
          <span className="text-slate-400 truncate flex-1 max-w-[120px]">{e.name}</span>
          <span className="font-mono text-slate-100 font-semibold tabular-nums">
            {fmtPriceFull(e.value, indexed)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none group">
      <div
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={`w-8 h-4 rounded-full relative transition-colors ${on ? "bg-amber-500" : "bg-slate-700"}`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
      <span
        className={`text-xs transition-colors ${
          on ? "text-amber-400" : "text-slate-500 group-hover:text-slate-300"
        }`}
      >
        {label}
      </span>
    </label>
  );
}

// ── Feature Cards ─────────────────────────────────────────────────────────────

function FeatureCards() {
  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="w-5 h-5 text-amber-400" />
          <span className="font-mono text-xs text-amber-400/80 tracking-widest uppercase">
            Analytics Platform
          </span>
        </div>
        <h1 className="text-4xl font-bold text-slate-100 mb-2 tracking-tight">CommodityIQ</h1>
        <p className="text-slate-400 text-lg">AI-Powered Commodity Trading Analytics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Link
              key={mod.href}
              href={mod.href}
              className="group glass-card rounded-xl p-6 border border-commodity-border hover:border-amber-500/30 transition-all duration-200 hover:-translate-y-0.5 backdrop-blur-sm"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`flex items-center justify-center w-10 h-10 rounded-lg border ${mod.iconBg}`}>
                  <Icon className={`w-5 h-5 ${mod.color}`} />
                </div>
                <span
                  className={`font-mono text-[11px] px-2.5 py-1 rounded-full border ${
                    mod.status === "active"
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                      : "text-amber-400 bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  {mod.status === "active" ? "Active" : "Coming Soon"}
                </span>
              </div>
              <h3 className="font-semibold text-slate-100 text-base mb-1.5 group-hover:text-white transition-colors">
                {mod.label}
              </h3>
              <p className="text-slate-500 text-sm leading-relaxed mb-4">{mod.description}</p>
              <div
                className={`flex items-center gap-1 text-xs font-medium ${mod.color} opacity-0 group-hover:opacity-100 transition-opacity`}
              >
                <span>Open module</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);

  const {
    datasets,
    activeDatasetIds,
    toggleActiveDataset,
    removeDataset,
  } = useCommodityStore();

  const [chartType, setChartType]   = useState<"line" | "area">("line");
  const [indexTo100, setIndexTo100] = useState(false);
  const [logScale, setLogScale]     = useState(false);
  const [chartRange, setChartRange] = useState<RangePill>("All");
  const [rightAxisIds, setRightAxisIds] = useState<Set<string>>(new Set());
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  function toggleAxis(id: string) {
    if (indexTo100) return;
    setRightAxisIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const activeDatasets = useMemo(
    () => datasets.filter((d) => activeDatasetIds.includes(d.id)),
    [datasets, activeDatasetIds]
  );

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    datasets.forEach((d, i) => { map[d.id] = DATASET_COLORS[i % DATASET_COLORS.length]; });
    return map;
  }, [datasets]);

  const filteredMap = useMemo(() => {
    const result: Record<string, OHLCVRecord[]> = {};
    activeDatasets.forEach((ds) => { result[ds.id] = filterRecords(ds.records, chartRange); });
    return result;
  }, [activeDatasets, chartRange]);

  useEffect(() => {
    if (indexTo100 || activeDatasets.length < 2) { setSuggestion(null); return; }
    const latest = activeDatasets.map((ds) => {
      const recs = filteredMap[ds.id] ?? [];
      return { id: ds.id, name: ds.name, close: recs.length > 0 ? recs[recs.length - 1].close : 0 };
    }).filter((x) => x.close > 0);
    if (latest.length < 2) { setSuggestion(null); return; }
    const maxClose = Math.max(...latest.map((x) => x.close));
    const minClose = Math.min(...latest.map((x) => x.close));
    if (maxClose / minClose > 10) {
      const outlier = latest.find(
        (x) => !rightAxisIds.has(x.id) && (x.close === maxClose || x.close === minClose)
      );
      setSuggestion(
        outlier
          ? `${outlier.name} has a very different price scale. Consider moving it to the right axis (R badge) for better visibility.`
          : null
      );
    } else {
      setSuggestion(null);
    }
  }, [activeDatasets, filteredMap, indexTo100, rightAxisIds]);

  const spanDays = useMemo(() => {
    const min = getMinDate(chartRange);
    if (!min) {
      const allRecs = Object.values(filteredMap).flat();
      if (allRecs.length < 2) return 365;
      const times = allRecs.map((r) => new Date(r.date).getTime());
      return (Math.max(...times) - Math.min(...times)) / 86_400_000;
    }
    return (Date.now() - min.getTime()) / 86_400_000;
  }, [chartRange, filteredMap]);

  const hasRightAxis = !indexTo100 && rightAxisIds.size > 0;

  const chartData = useMemo(() => {
    if (activeDatasets.length === 0) return [];
    const allDates = new Set<string>();
    const rawByDate: Record<string, Record<string, number>> = {};
    const basePrices: Record<string, number> = {};

    activeDatasets.forEach((ds) => {
      const recs = filteredMap[ds.id] ?? [];
      if (recs.length > 0) basePrices[ds.id] = recs[0].close;
      recs.forEach((r) => {
        allDates.add(r.date);
        (rawByDate[r.date] ??= {})[ds.id] = r.close;
      });
    });

    return Array.from(allDates)
      .sort()
      .map((date) => {
        const pt: Record<string, string | number> = { date };
        activeDatasets.forEach((ds) => {
          const raw = rawByDate[date]?.[ds.id];
          if (raw !== undefined) {
            pt[ds.id] =
              indexTo100 && basePrices[ds.id]
                ? (raw / basePrices[ds.id]) * 100
                : raw;
          }
        });
        return pt;
      });
  }, [activeDatasets, filteredMap, indexTo100]);

  // ── Chart series builder ─────────────────────────────────────────────────

  const buildSeries = (type: "line" | "area") =>
    activeDatasets.map((ds) => {
      const color   = colorMap[ds.id];
      const yAxisId = hasRightAxis && rightAxisIds.has(ds.id) ? "right" : "left";
      const common  = {
        key: ds.id,
        type: "monotone" as const,
        dataKey: ds.id,
        name: ds.name,
        stroke: color,
        strokeWidth: 2,
        dot: false,
        activeDot: { r: 4, strokeWidth: 0, fill: color },
        yAxisId,
        connectNulls: true,
        animationDuration: 400,
      };
      if (type === "area")
        return <Area {...common} fill={color} fillOpacity={0.07} />;
      return <Line {...common} />;
    });

  const commonAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={(v: string) => fmtAxisDate(v, spanDays)}
        tick={{ fontSize: 10, fill: "#94a3b8" }}
        axisLine={false}
        tickLine={false}
        minTickGap={52}
      />
      <YAxis
        yAxisId="left"
        orientation="left"
        tickFormatter={(v: number) => fmtAxisPrice(v, indexTo100)}
        tick={{ fontSize: 10, fill: "#94a3b8" }}
        axisLine={false}
        tickLine={false}
        scale={logScale ? "log" : "linear"}
        domain={logScale ? ["auto", "auto"] : undefined}
        width={70}
      />
      {hasRightAxis && (
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v: number) => fmtAxisPrice(v, indexTo100)}
          tick={{ fontSize: 10, fill: "#f59e0b" }}
          axisLine={false}
          tickLine={false}
          width={70}
        />
      )}
      <Tooltip
        content={(props) => (
          <ChartTooltip
            active={props.active}
            payload={props.payload as unknown as TooltipEntry[] | undefined}
            label={props.label as string | undefined}
            indexed={indexTo100}
          />
        )}
        animationDuration={0}
      />
      <Legend wrapperStyle={{ fontSize: "11px", color: "#64748b", paddingTop: "12px" }} />
    </>
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 animate-fade-in space-y-10">

      {/* Sections A–D — only after hydration when data exists */}
      {mounted && datasets.length > 0 && (
        <div className="space-y-5">

          {/* A — Dataset selector chips */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[11px] text-slate-500 uppercase tracking-wider shrink-0">
              Datasets
            </span>
            <div className="flex gap-2 flex-wrap">
              {datasets.map((ds) => {
                const isActive = activeDatasetIds.includes(ds.id);
                const color    = colorMap[ds.id];
                return (
                  <div
                    key={ds.id}
                    className={`flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border text-xs font-medium transition-all ${
                      isActive
                        ? "border-slate-600 bg-slate-800 text-slate-200"
                        : "border-slate-700/40 bg-transparent text-slate-500 opacity-50"
                    }`}
                  >
                    <button
                      onClick={() => toggleActiveDataset(ds.id)}
                      className="flex items-center gap-1.5"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="whitespace-nowrap">{ds.name}</span>
                    </button>
                    {isActive && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAxis(ds.id); }}
                        disabled={indexTo100}
                        title={
                          indexTo100
                            ? "Axis toggle disabled in Index mode"
                            : rightAxisIds.has(ds.id)
                            ? `Move ${ds.name} to left axis`
                            : `Move ${ds.name} to right axis`
                        }
                        className={`min-w-[18px] min-h-[18px] flex items-center justify-center rounded text-[9px] font-bold transition-colors ${
                          indexTo100
                            ? "opacity-30 cursor-not-allowed"
                            : "cursor-pointer"
                        } ${
                          rightAxisIds.has(ds.id)
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            : "bg-slate-700/60 text-slate-400 border border-slate-600/40 hover:bg-slate-600/60 hover:text-slate-300"
                        }`}
                        aria-label={`Toggle Y-axis for ${ds.name}`}
                      >
                        {rightAxisIds.has(ds.id) ? "R" : "L"}
                      </button>
                    )}
                    <button
                      onClick={() => removeDataset(ds.id)}
                      className="ml-0.5 p-0.5 rounded-full text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                      aria-label={`Remove ${ds.name}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Axis suggestion toast */}
          {suggestion && !indexTo100 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400/90">
              <span className="shrink-0">&#x1F4A1;</span>
              <span className="flex-1">{suggestion}</span>
              <button
                onClick={() => setSuggestion(null)}
                className="ml-auto p-0.5 rounded-full hover:bg-amber-500/20 transition-colors shrink-0"
                aria-label="Dismiss suggestion"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* B — Chart controls */}
          {activeDatasets.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-commodity-card border border-commodity-border rounded-xl px-4 py-3">
              {/* Range pills */}
              <div className="flex flex-wrap gap-1">
                {RANGE_PILLS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setChartRange(p)}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors ${
                      chartRange === p
                        ? "bg-amber-500 text-slate-900"
                        : "bg-commodity-panel border border-commodity-border text-slate-500 hover:text-slate-200 hover:border-slate-500"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-slate-700 hidden sm:block" />

              {/* Chart type */}
              <div className="flex gap-0.5 bg-commodity-panel border border-commodity-border rounded-lg p-0.5">
                {(["Line", "Area"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t.toLowerCase() as "line" | "area")}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      chartType === t.toLowerCase()
                        ? "bg-commodity-card text-slate-100 shadow-sm"
                        : "text-slate-500 hover:text-slate-200"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-slate-700 hidden sm:block" />

              <ToggleSwitch
                on={indexTo100}
                onToggle={() => {
                  const turningOn = !indexTo100;
                  setIndexTo100(turningOn);
                  setLogScale(false);
                  if (turningOn) { setRightAxisIds(new Set()); setSuggestion(null); }
                }}
                label="Index to 100"
              />
              <ToggleSwitch
                on={logScale}
                onToggle={() => { setLogScale(!logScale); setIndexTo100(false); }}
                label="Log Scale"
              />
              {indexTo100 && (
                <span className="text-[10px] text-slate-500 italic">Axis toggle disabled in Index mode</span>
              )}
            </div>
          )}

          {/* C — Main chart */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl py-4 px-2">
            {activeDatasets.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                Click a dataset chip above to plot it.
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                No data available for the selected range.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={450}>
                {chartType === "area" ? (
                  <AreaChart data={chartData} margin={{ top: 4, right: hasRightAxis ? 4 : 8, left: 0, bottom: 0 }}>
                    {commonAxes}
                    {buildSeries("area")}
                  </AreaChart>
                ) : (
                  <LineChart data={chartData} margin={{ top: 4, right: hasRightAxis ? 4 : 8, left: 0, bottom: 0 }}>
                    {commonAxes}
                    {buildSeries("line")}
                  </LineChart>
                )}
              </ResponsiveContainer>
            )}
          </div>

          {/* D — Summary stats cards */}
          {activeDatasets.length > 0 && (
            <div className="overflow-x-auto">
              <div className="flex gap-4 pb-1" style={{ minWidth: "max-content" }}>
                {activeDatasets.map((ds) => {
                  const recs  = filteredMap[ds.id] ?? [];
                  if (recs.length === 0) return null;
                  const cur   = recs[recs.length - 1];
                  const prev  = recs[recs.length - 2];
                  const chg   = prev ? cur.close - prev.close : 0;
                  const pct   = prev ? (chg / prev.close) * 100 : 0;
                  const hi    = Math.max(...recs.map((r) => r.high));
                  const lo    = Math.min(...recs.map((r) => r.low));
                  const color = colorMap[ds.id];
                  const isPos = chg >= 0;
                  return (
                    <div
                      key={ds.id}
                      className="min-w-[200px] bg-commodity-card border border-commodity-border rounded-xl p-4 relative hover:border-slate-600 transition-colors"
                    >
                      <span
                        className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <p className="text-slate-500 text-[11px] mb-1.5 truncate pr-5 font-medium">
                        {ds.name}
                      </p>
                      <p className="text-2xl font-bold font-mono text-slate-100 leading-none mb-1">
                        {fmtPriceFull(cur.close, false)}
                      </p>
                      {prev ? (
                        <p className={`text-sm font-mono font-semibold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                          {isPos ? "+" : ""}{fmtPriceFull(chg, false)}{" "}
                          <span className="text-xs opacity-80">
                            ({isPos ? "+" : ""}{pct.toFixed(2)}%)
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 font-mono">No prev. close</p>
                      )}
                      <p className="text-slate-500 text-[11px] mt-2 font-mono">
                        H:&nbsp;{fmtPriceFull(hi, false)}&nbsp;&nbsp;L:&nbsp;{fmtPriceFull(lo, false)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* E — Feature cards (always visible) */}
      <FeatureCards />

    </div>
  );
}
