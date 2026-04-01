"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import ExplainButton from "@/components/ui/ExplainButton";
import {
  AlertCircle, Loader2, RefreshCw, Save, BarChart2,
  TrendingUp, TrendingDown, HelpCircle, ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar,
  Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend,
} from "recharts";
import { useCommodityStore } from "@/lib/store";
import { runScenario, compareScenarios, runSensitivity, getHistoricalEvents, replayEvent, calculateRiskMetrics } from "@/lib/api";
import type { ScenarioResult, ScenarioRequest, ScenarioCompareResult, SensitivityResult, TornadoEntry, PDPEntry, ElasticityEntry, HistoricalEvent, ReplayResult, RiskMetricsResult, VarEntry, CvarEntry, StressTestEntry } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const DRIVER_META = [
  {
    key: "supply",
    label: "Supply Disruption",
    tip: "Production cuts, sanctions, or infrastructure damage. Positive = supply reduction = price up.",
    weight: 0.4,
    sign: 1,
  },
  {
    key: "demand",
    label: "Demand Shift",
    tip: "Economic growth, industrial demand, seasonal changes. Positive = more demand = price up.",
    weight: 0.35,
    sign: 1,
  },
  {
    key: "usd",
    label: "USD Index Change",
    tip: "Dollar strength/weakness vs basket. Positive = stronger USD = commodities price down.",
    weight: 0.15,
    sign: -1,
  },
  {
    key: "inventory",
    label: "Inventory Change",
    tip: "Strategic reserves, storage levels. Positive = inventory build = price down.",
    weight: 0.1,
    sign: -1,
  },
] as const;

type DriverKey = typeof DRIVER_META[number]["key"];
type Drivers = Record<DriverKey, number>;

const NEUTRAL: Drivers = { supply: 0, demand: 0, usd: 0, inventory: 0 };

const PRESETS: { label: string; emoji: string; values: Drivers }[] = [
  { label: "Bull Case",    emoji: "🐂", values: { supply: -10, demand: 15,  usd: -5,  inventory: -10 } },
  { label: "Bear Case",   emoji: "🐻", values: { supply: 10,  demand: -15, usd: 10,  inventory: 15  } },
  { label: "Supply Shock",emoji: "⚡", values: { supply: 30,  demand: 0,   usd: 0,   inventory: -5  } },
  { label: "Recession",   emoji: "📉", values: { supply: 0,   demand: -25, usd: 15,  inventory: 20  } },
];

const SIM_OPTIONS = [500, 1000, 5000, 10000];
const HORIZON_PRESETS = [
  { label: "1M", value: 30 },
  { label: "3M", value: 90 },
  { label: "6M", value: 180 },
  { label: "1Y", value: 365 },
];

const SCENARIO_COLORS = ["#f59e0b","#3b82f6","#a78bfa","#10b981","#f43f5e","#06b6d4"];

// ── Helpers ────────────────────────────────────────────────────────────────────

const fp = (v: number, dec = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

function logReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  }
  return r;
}

function annualVol(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

function fmtAxisDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DriverSlider({
  meta,
  value,
  onChange,
}: {
  meta: typeof DRIVER_META[number];
  value: number;
  onChange: (v: number) => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const impact = (value * meta.weight * meta.sign).toFixed(1);
  const color =
    value > 0 ? (meta.sign > 0 ? "text-emerald-400" : "text-red-400")
    : value < 0 ? (meta.sign > 0 ? "text-red-400" : "text-emerald-400")
    : "text-slate-400";

  const trackPct = ((value + 50) / 100) * 100;
  const thumbColor = value > 0 ? "#10b981" : value < 0 ? "#ef4444" : "#64748b";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-slate-300">{meta.label}</span>
          <div className="relative">
            <button
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            {showTip && (
              <div className="absolute left-5 top-0 z-50 w-56 bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-xs text-slate-300 shadow-xl">
                {meta.tip}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-mono font-bold ${color}`}>
            {value > 0 ? "+" : ""}{value}%
          </span>
          <span className="text-xs text-slate-500 font-mono">
            impact: <span className={color}>{Number(impact) >= 0 ? "+" : ""}{impact}%</span>
          </span>
        </div>
      </div>
      <div className="relative">
        <style>{`
          .driver-range-${meta.key}::-webkit-slider-thumb { background: ${thumbColor}; }
          .driver-range-${meta.key}::-moz-range-thumb { background: ${thumbColor}; }
        `}</style>
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full pointer-events-none"
          style={{
            left: "50%",
            width: `${Math.abs(trackPct - 50)}%`,
            marginLeft: trackPct >= 50 ? 0 : `${trackPct - 50}%`,
            background: value > 0 ? "#10b981" : value < 0 ? "#ef4444" : "#475569",
          }}
        />
        <input
          type="range"
          min={-50}
          max={50}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`driver-range-${meta.key} w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer`}
          style={{
            WebkitAppearance: "none",
          }}
        />
        <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
          <span>-50%</span>
          <span>0</span>
          <span>+50%</span>
        </div>
      </div>
    </div>
  );
}

function FanChart({
  result,
  historical,
  showSpaghetti,
}: {
  result: ScenarioResult;
  historical: { date: string; price: number }[];
  showSpaghetti: boolean;
}) {
  const histSlice = historical.slice(-90);

  const histData = histSlice.map((h) => ({
    date: h.date,
    hist: h.price,
    zone: "hist",
  }));

  const today = histSlice[histSlice.length - 1];
  const currentPrice = today?.price ?? result.current_price;

  const forecastData = result.forecast_dates.map((d, i) => {
    const p = result.percentile_paths;
    return {
      date: d,
      P10: p["P10"]?.[i],
      P25: p["P25"]?.[i],
      P50: p["P50"]?.[i],
      P75: p["P75"]?.[i],
      P90: p["P90"]?.[i],
      band1: [p["P10"]?.[i], p["P90"]?.[i]] as [number, number],
      band2: [p["P25"]?.[i], p["P75"]?.[i]] as [number, number],
      currentRef: currentPrice,
      zone: "forecast",
    };
  });

  const spaghettiData = showSpaghetti
    ? result.forecast_dates.map((d, i) => {
        const row: Record<string, number | string> = { date: d };
        result.sample_paths.forEach((path, pi) => {
          row[`sp${pi}`] = path[i];
        });
        return row;
      })
    : [];

  const allData = [
    ...histData,
    { date: today?.date, hist: currentPrice, divider: true },
    ...forecastData,
  ];

  const spaghettiColors = [
    "#f59e0b","#fbbf24","#fcd34d","#d97706","#92400e",
    "#fb923c","#f97316","#ea580c","#c2410c","#9a3412",
    "#fde68a","#fef3c7","#fef9c3","#fefce8","#fffbeb",
    "#fed7aa","#fdba74","#fb923c","#f97316","#ea580c",
  ];

  return (
    <ResponsiveContainer width="100%" height={460}>
      <ComposedChart data={allData} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
        <defs>
          <linearGradient id="band1Grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="band2Grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.15} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickLine={false}
          tickFormatter={fmtAxisDate}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickLine={false}
          tickFormatter={(v) => "$" + Number(v).toLocaleString()}
          width={70}
        />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#94a3b8" }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => [typeof value === "number" ? fp(value) : String(value ?? "")]}
        />
        <ReferenceLine
          x={today?.date}
          stroke="#475569"
          strokeDasharray="4 4"
          label={{ value: "Today", fill: "#64748b", fontSize: 10, position: "top" }}
        />
        <ReferenceLine
          y={currentPrice}
          stroke="#e2e8f0"
          strokeDasharray="3 3"
          strokeOpacity={0.4}
          label={{ value: `Current ${fp(currentPrice)}`, fill: "#94a3b8", fontSize: 10, position: "right" }}
        />
        {showSpaghetti &&
          result.sample_paths.map((_, pi) => (
            <Line
              key={`sp${pi}`}
              data={spaghettiData}
              dataKey={`sp${pi}`}
              dot={false}
              stroke={spaghettiColors[pi % spaghettiColors.length]}
              strokeWidth={0.5}
              strokeOpacity={0.25}
              legendType="none"
              isAnimationActive={false}
            />
          ))}
        <Area
          dataKey="band1"
          data={forecastData}
          fill="url(#band1Grad)"
          stroke="none"
          name="P10–P90"
        />
        <Area
          dataKey="band2"
          data={forecastData}
          fill="url(#band2Grad)"
          stroke="none"
          name="P25–P75"
        />
        <Line
          data={forecastData}
          dataKey="P50"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          name="P50 Median"
          isAnimationActive={false}
        />
        <Line
          data={forecastData}
          dataKey="P10"
          stroke="#f59e0b"
          strokeWidth={1}
          strokeDasharray="4 2"
          dot={false}
          strokeOpacity={0.5}
          name="P10"
          isAnimationActive={false}
        />
        <Line
          data={forecastData}
          dataKey="P90"
          stroke="#f59e0b"
          strokeWidth={1}
          strokeDasharray="4 2"
          dot={false}
          strokeOpacity={0.5}
          name="P90"
          isAnimationActive={false}
        />
        <Line
          data={histData}
          dataKey="hist"
          stroke="#64748b"
          strokeWidth={1.5}
          dot={false}
          name="Historical"
          isAnimationActive={false}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 8 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function TerminalHistogram({
  result,
}: {
  result: ScenarioResult;
}) {
  const { bins, counts } = result.terminal_histogram;
  const current = result.current_price;
  const p50 = result.terminal_stats.p50;

  const data = bins.map((bin, i) => ({
    bin,
    count: counts[i],
    fill: bin < current ? "#ef4444" : "#10b981",
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="bin"
          tick={{ fill: "#64748b", fontSize: 10 }}
          tickFormatter={(v) => "$" + Number(v).toLocaleString()}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => [v, "Simulations"]}
          labelFormatter={(v) => fp(Number(v))}
        />
        <ReferenceLine
          x={current}
          stroke="#e2e8f0"
          strokeDasharray="4 4"
          label={{ value: `Current ${fp(current, 0)}`, fill: "#94a3b8", fontSize: 10, position: "top" }}
        />
        <ReferenceLine
          x={p50}
          stroke="#f59e0b"
          strokeDasharray="4 4"
          label={{ value: `Median ${fp(p50, 0)}`, fill: "#f59e0b", fontSize: 10, position: "top" }}
        />
        <Bar dataKey="count" isAnimationActive={false}>
          {data.map((entry, i) => (
            <rect key={i} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Risk Metrics Sub-components ──────────────────────────────────────────────────

const STRESS_ROW_STYLES: Record<string, string> = {
  "Normal Market":   "bg-emerald-500/5",
  "High Volatility": "bg-amber-500/5",
  "Market Crash":    "bg-orange-500/8",
  "Flash Crash":     "bg-red-500/10",
  "Sustained Rally": "bg-emerald-500/8",
};

const RISK_RATING_STYLES: Record<string, { badge: string; text: string }> = {
  Low:       { badge: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400", text: "text-emerald-400" },
  Medium:    { badge: "bg-amber-500/15 border border-amber-500/30 text-amber-400",     text: "text-amber-400" },
  High:      { badge: "bg-orange-500/15 border border-orange-500/30 text-orange-400",  text: "text-orange-400" },
  "Very High": { badge: "bg-red-500/15 border border-red-500/30 text-red-400",         text: "text-red-400" },
};

function VarSummaryPanel({
  varResults, cvarResults, horizon,
}: { varResults: VarEntry[]; cvarResults: CvarEntry[]; horizon: number }) {
  const cvarMap = Object.fromEntries(cvarResults.map((c) => [c.confidence, c.cvar]));
  const pct = (v: number, price: number) =>
    price > 0 ? ` (${((v / price) * 100).toFixed(2)}%)` : "";
  const basePrice = varResults[0] ? Math.abs(varResults[0].mc_var) + Math.abs(varResults[0].mc_var) : 0;
  void basePrice;
  const methods = [
    { key: "parametric_var" as const, label: "Parametric VaR", tip: "Assumes normal distribution" },
    { key: "historical_var" as const, label: "Historical VaR", tip: "From actual return distribution" },
    { key: "mc_var"         as const, label: "Monte Carlo VaR", tip: "From simulation terminal prices" },
  ];
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-slate-500">
        Calculated for <span className="font-mono text-amber-400">{horizon}-day</span> horizon — larger values = greater potential loss
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {methods.map(({ key, label, tip }) => (
          <div key={key} className="bg-[#0f172a] rounded-xl p-4">
            <p className="text-[10px] text-slate-500 mb-1">{tip}</p>
            <p className="text-xs font-semibold text-slate-300 mb-3">{label}</p>
            {varResults.map((row) => {
              const val = row[key];
              const cvar = key === "mc_var" ? cvarMap[row.confidence] : null;
              return (
                <div key={row.confidence} className="mb-2 last:mb-0">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[10px] text-slate-500">{(row.confidence * 100).toFixed(0)}% CI</span>
                    <span className="text-sm font-mono font-bold text-red-400">
                      {fp(val)}{pct(val, Math.abs(val))}
                    </span>
                  </div>
                  {cvar !== undefined && cvar !== null && (
                    <div className="flex justify-between items-baseline mt-1">
                      <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                        <AlertCircle className="w-2.5 h-2.5" />CVaR
                      </span>
                      <span className="text-xs font-mono font-semibold text-amber-500">
                        {fp(cvar)}{pct(cvar, Math.abs(cvar))}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {varResults[0] && (
        <p className="text-[11px] text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
          With <span className="text-amber-400 font-semibold">{(varResults[0].confidence * 100).toFixed(0)}% confidence</span>, the maximum expected loss over{" "}
          <span className="font-mono text-amber-400">{horizon}</span> days is{" "}
          <span className="font-mono text-red-400">{fp(Math.abs(varResults[0].mc_var))}</span> (MC estimate).
        </p>
      )}
    </div>
  );
}

function DrawdownChart({ drawdown }: { drawdown: RiskMetricsResult["drawdown"] }) {
  const series = drawdown.drawdown_series;
  const n = series.length;
  const step = Math.max(1, Math.floor(n / 200));
  const sampled = series.filter((_, i) => i % step === 0);
  const tickStep = Math.max(1, Math.floor(sampled.length / 6));
  const fmtDate = (v: string) => {
    const d = new Date(v);
    return `${d.getFullYear().toString().slice(2)}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const maxDDPoint = sampled.reduce(
    (best, p) => (p.drawdown_pct < best.drawdown_pct ? p : best),
    sampled[0] ?? { drawdown_pct: 0, date: "" }
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Historical Drawdown</p>
        <div className="flex gap-4 text-[10px] font-mono">
          <span className="text-red-400">Max: {drawdown.max_drawdown_pct.toFixed(2)}%</span>
          <span className="text-amber-400">Current: {drawdown.current_drawdown_pct.toFixed(2)}%</span>
          {drawdown.recovery_days !== null && (
            <span className="text-slate-400">Recovery: {drawdown.recovery_days}d</span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={sampled} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            ticks={sampled.filter((_, i) => i % tickStep === 0).map((d) => d.date)}
            tickFormatter={fmtDate}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            width={44}
            domain={["dataMin", 0]}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "Drawdown"]}
            labelFormatter={(v) => String(v)}
          />
          <ReferenceLine y={-10} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.4}
            label={{ value: "-10%", fill: "#ef444470", fontSize: 9, position: "right" }} />
          <ReferenceLine y={-20} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6}
            label={{ value: "-20%", fill: "#ef444490", fontSize: 9, position: "right" }} />
          <ReferenceLine y={-30} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.8}
            label={{ value: "-30%", fill: "#ef4444", fontSize: 9, position: "right" }} />
          <Area
            type="monotone"
            dataKey="drawdown_pct"
            stroke="#ef4444"
            strokeWidth={1.5}
            fill="url(#dd-fill)"
            dot={false}
            isAnimationActive={false}
          />
          {maxDDPoint && (
            <ReferenceLine
              x={maxDDPoint.date}
              stroke="#ef4444"
              strokeWidth={1}
              label={{ value: `● ${maxDDPoint.drawdown_pct.toFixed(1)}%`, fill: "#ef4444", fontSize: 9, position: "top" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Top 5 Drawdowns Table */}
      {drawdown.top_5_drawdowns.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Top {drawdown.top_5_drawdowns.length} Drawdown Episodes</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-commodity-border">
                  {["#", "Start", "End", "Depth", "Duration"].map((h) => (
                    <th key={h} className="text-left text-[10px] text-slate-500 uppercase tracking-wider py-1.5 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drawdown.top_5_drawdowns.map((ep, i) => (
                  <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/20">
                    <td className="py-1.5 pr-4 text-slate-500">{i + 1}</td>
                    <td className="py-1.5 pr-4 text-slate-300">{ep.start_date}</td>
                    <td className="py-1.5 pr-4 text-slate-300">{ep.end_date}</td>
                    <td className="py-1.5 pr-4 text-red-400 font-semibold">{ep.depth_pct.toFixed(2)}%</td>
                    <td className="py-1.5 pr-4 text-slate-400">{ep.duration_days}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StressTestMatrix({ tests, currentPrice }: { tests: StressTestEntry[]; currentPrice: number }) {
  const maxAbsLoss = Math.max(...tests.map((t) => Math.abs(t.max_loss_pct)), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-commodity-border">
            {["Scenario", "Vol ×", "P5 Price", "P50 Price", "Max Loss", "Prob Loss >10%"].map((h) => (
              <th key={h} className="text-left text-[10px] text-slate-500 uppercase tracking-wider py-2 pr-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => {
            const rowBg = STRESS_ROW_STYLES[t.scenario] ?? "";
            const lossIntensity = Math.min(Math.abs(t.max_loss_pct) / maxAbsLoss, 1);
            const lossColor = t.max_loss_pct < -20 ? "text-red-400" : t.max_loss_pct < -10 ? "text-orange-400" : t.max_loss_pct < 0 ? "text-amber-400" : "text-emerald-400";
            const p5Color  = t.p5_price < currentPrice ? "text-red-400" : "text-emerald-400";
            const p50Color = t.p50_price < currentPrice ? "text-amber-400" : "text-emerald-400";
            return (
              <tr key={t.scenario} className={`border-b border-slate-800/40 ${rowBg}`}>
                <td className="py-2.5 pr-4">
                  <span className="font-semibold text-slate-200">{t.scenario}</span>
                </td>
                <td className="py-2.5 pr-4 font-mono text-slate-400">{t.vol_multiplier.toFixed(1)}×</td>
                <td className={`py-2.5 pr-4 font-mono ${p5Color}`}>{fp(t.p5_price)}</td>
                <td className={`py-2.5 pr-4 font-mono ${p50Color}`}>{fp(t.p50_price)}</td>
                <td className={`py-2.5 pr-4 font-mono font-semibold ${lossColor}`}>
                  {t.max_loss_pct.toFixed(2)}%
                </td>
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{ width: `${t.prob_loss_gt_10pct}%`, opacity: 0.4 + lossIntensity * 0.6 }}
                      />
                    </div>
                    <span className="font-mono text-slate-400 w-8 text-right">{t.prob_loss_gt_10pct.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiskSummaryCard({
  summary, maxDrawdownPct, datasetName,
}: { summary: RiskMetricsResult["risk_summary"]; maxDrawdownPct: number; datasetName: string }) {
  const rs = RISK_RATING_STYLES[summary.risk_rating] ?? RISK_RATING_STYLES["High"];
  const metrics = [
    { label: "Annualized Volatility", value: `${summary.annualized_volatility.toFixed(2)}%`, sub: "vs S&P 500: ~15%" },
    { label: "Sharpe Ratio",          value: summary.sharpe_ratio.toFixed(3),               sub: ">1 is good" },
    { label: "Sortino Ratio",         value: summary.sortino_ratio.toFixed(3),              sub: "downside-adj." },
    { label: "Max Drawdown",          value: `${maxDrawdownPct.toFixed(2)}%`,               sub: "all-time" },
  ];
  return (
    <div className="bg-[#0f172a] rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Overall Risk Assessment</p>
          <p className="text-sm text-slate-300">
            <span className="font-semibold">{datasetName}</span> exhibits{" "}
            <span className={rs.text}>{summary.risk_rating}</span> risk with an annualized volatility of{" "}
            <span className="font-mono text-amber-400">{summary.annualized_volatility.toFixed(2)}%</span> and a maximum historical drawdown of{" "}
            <span className="font-mono text-red-400">{maxDrawdownPct.toFixed(2)}%</span>.
          </p>
        </div>
        <span className={`shrink-0 text-sm font-bold px-3 py-1.5 rounded-lg ${rs.badge}`}>
          {summary.risk_rating}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map(({ label, value, sub }) => (
          <div key={label} className="text-center bg-slate-900/60 rounded-lg p-3">
            <div className="text-base font-mono font-bold text-slate-100">{value}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{label}</div>
            <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Historical Event Replay Sub-components ────────────────────────────────────

const CATEGORY_STYLES: Record<string, { badge: string; dot: string }> = {
  "Financial Crisis": { badge: "bg-red-500/15 text-red-400 border border-red-500/25", dot: "bg-red-500" },
  "Pandemic":         { badge: "bg-purple-500/15 text-purple-400 border border-purple-500/25", dot: "bg-purple-500" },
  "Geopolitical":     { badge: "bg-orange-500/15 text-orange-400 border border-orange-500/25", dot: "bg-orange-500" },
  "Supply Chain":     { badge: "bg-blue-500/15 text-blue-400 border border-blue-500/25", dot: "bg-blue-500" },
  "OPEC Policy":      { badge: "bg-amber-500/15 text-amber-400 border border-amber-500/25", dot: "bg-amber-500" },
  "Demand Shock":     { badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25", dot: "bg-emerald-500" },
};

const SEVERITY_STYLES: Record<string, string> = {
  extreme: "bg-red-500/20 text-red-400 ring-1 ring-red-500/40",
  high:    "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40",
  moderate:"bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30",
};

function EventCard({ event, selected, onApply }: { event: HistoricalEvent; selected: boolean; onApply: () => void }) {
  const cat = CATEGORY_STYLES[event.category] ?? { badge: "bg-slate-700 text-slate-300", dot: "bg-slate-400" };
  const sev = SEVERITY_STYLES[event.severity] ?? "bg-slate-700 text-slate-300";
  return (
    <div className={`relative flex flex-col gap-2 p-4 rounded-xl border transition-all cursor-pointer ${
      selected
        ? "border-amber-500/60 bg-amber-500/5 shadow-[0_0_12px_rgba(245,158,11,0.12)]"
        : "border-commodity-border bg-gradient-to-b from-slate-800/60 to-slate-900/60 hover:border-slate-600"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 leading-snug">{event.name}</p>
          <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{event.period}</p>
        </div>
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${sev}`}>
          {event.severity}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{event.description}</p>
      <div className="flex items-center justify-between mt-auto pt-1">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${cat.badge}`}>{event.category}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onApply(); }}
          className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors font-semibold"
        >
          Apply →
        </button>
      </div>
    </div>
  );
}

function EventDriverBars({ drivers }: { drivers: HistoricalEvent["drivers"] }) {
  const max = Math.max(...drivers.map((d) => Math.abs(d.value)), 1);
  return (
    <div className="space-y-2">
      {drivers.map((d) => (
        <div key={d.name} className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 w-32 shrink-0 truncate">{d.name}</span>
          <div className="flex-1 relative h-4 bg-slate-800 rounded-full overflow-hidden">
            {d.value !== 0 && (
              <div
                className={`absolute top-0 h-full rounded-full ${
                  d.value > 0 ? "bg-emerald-500/70" : "bg-red-500/70"
                }`}
                style={{
                  width: `${(Math.abs(d.value) / max) * 100}%`,
                  left: d.value < 0 ? `${100 - (Math.abs(d.value) / max) * 100}%` : "0",
                }}
              />
            )}
          </div>
          <span className={`text-[11px] font-mono w-10 text-right ${
            d.value > 0 ? "text-emerald-400" : d.value < 0 ? "text-red-400" : "text-slate-500"
          }`}>{d.value > 0 ? "+" : ""}{d.value}%</span>
        </div>
      ))}
    </div>
  );
}

function ReplayOverlayChart({
  result, eventName,
}: { result: ReplayResult; eventName: string }) {
  const sim = result.simulated;
  const actual = result.actual_path;

  const n = sim.forecast_dates.length;
  const p10 = sim.percentile_paths["P10"] ?? [];
  const p50 = sim.percentile_paths["P50"] ?? [];
  const p90 = sim.percentile_paths["P90"] ?? [];

  // Build chart data indexed to 100 from start price
  const startPrice = sim.current_price;
  const chartData = sim.forecast_dates.map((date, i) => {
    const row: Record<string, unknown> = { date };
    if (p10[i] !== undefined) row.p10 = parseFloat(((p10[i] / startPrice) * 100).toFixed(2));
    if (p50[i] !== undefined) row.p50 = parseFloat(((p50[i] / startPrice) * 100).toFixed(2));
    if (p90[i] !== undefined) row.p90 = parseFloat(((p90[i] / startPrice) * 100).toFixed(2));
    if (p10[i] !== undefined && p90[i] !== undefined)
      row.band = [parseFloat(((p10[i] / startPrice) * 100).toFixed(2)), parseFloat(((p90[i] / startPrice) * 100).toFixed(2))];
    return row;
  });

  // Overlay actual indexed path, aligning by position
  if (actual && actual.length > 0) {
    actual.forEach((pt, i) => {
      if (i < chartData.length) (chartData[i] as Record<string, unknown>).actual = pt.indexed;
    });
  }

  const tickStep = Math.max(1, Math.floor(n / 6));
  const fmtTick = (v: string) => {
    const d = new Date(v);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 font-semibold uppercase tracking-wider">{eventName} — Simulated vs Actual (Indexed to 100)</p>
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="replay-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            ticks={chartData.filter((_, i) => i % tickStep === 0).map((d) => d.date as string)}
            tickFormatter={fmtTick}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            tickFormatter={(v) => v.toFixed(0)}
            width={42}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [
              (typeof v === "number" ? v.toFixed(1) : String(v)) + " (idx)",
              name === "p50" ? "Simulated P50" : name === "actual" ? "Actual" : String(name),
            ]}
            labelFormatter={(v) => String(v)}
          />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill="url(#replay-band)"
            isAnimationActive={false}
          />
          <Line type="monotone" dataKey="p10" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="p90" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="p50" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
          {actual && (
            <Line type="monotone" dataKey="actual" stroke="#f8fafc" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          )}
          <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3"
            label={{ value: "Start", fill: "#64748b", fontSize: 9, position: "right" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 8 }}
            formatter={(value) =>
              value === "p50" ? "Simulated P50" :
              value === "actual" ? "Actual Path" :
              value === "p10" ? "P10" : value === "p90" ? "P90" : value
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReplayComparisonCard({ cmp }: { cmp: NonNullable<ReplayResult["simulated_vs_actual"]> }) {
  const absDiv = Math.abs(cmp.difference);
  const accuracyColor = absDiv < 10 ? "text-emerald-400" : absDiv < 25 ? "text-amber-400" : "text-red-400";
  const accuracyBg = absDiv < 10 ? "bg-emerald-500/10 border-emerald-500/25" : absDiv < 25 ? "bg-amber-500/10 border-amber-500/25" : "bg-red-500/10 border-red-500/25";
  const overUnder = cmp.difference > 0 ? "overestimated" : "underestimated";
  const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  return (
    <div className={`rounded-xl border p-4 ${accuracyBg}`}>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-3">Model Accuracy vs History</p>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Simulated Impact", value: pct(cmp.simulated_return), color: cmp.simulated_return >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "Actual Impact", value: pct(cmp.actual_return), color: cmp.actual_return >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "Model Accuracy", value: pct(-absDiv), color: accuracyColor },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-3 text-center">
        The model <span className={accuracyColor}>{overUnder}</span> the impact by{" "}
        <span className={`font-mono ${accuracyColor}`}>{absDiv.toFixed(2)}%</span>
      </p>
    </div>
  );
}

// ── Sensitivity Sub-components ────────────────────────────────────────────────

function TornadoChart({ data, baselinePrice }: { data: TornadoEntry[]; baselinePrice: number }) {
  const chartData = data.map((d) => ({
    driver: d.driver.split(" ").slice(0, 2).join(" "),
    fullDriver: d.driver,
    negative_swing: d.negative_swing,
    positive_swing: d.positive_swing,
    price_at_low: d.price_at_low,
    price_at_high: d.price_at_high,
    swing: d.swing,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500">Baseline P50: <span className="font-mono text-amber-400">{fp(baselinePrice)}</span></span>
        <div className="flex items-center gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-red-500"></span>Bearish shock (−30%)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-emerald-500"></span>Bullish shock (+30%)</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 52)}>
        <BarChart layout="vertical" data={chartData} margin={{ top: 4, right: 80, bottom: 4, left: 8 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            tickFormatter={(v) => (v >= 0 ? "+" : "") + "$" + Math.round(v).toLocaleString()}
          />
          <YAxis
            type="category"
            dataKey="driver"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            width={110}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [
              fp(Math.abs(Number(v))) + (Number(v) >= 0 ? " above" : " below") + " baseline",
              name === "negative_swing" ? "Bearish shock" : "Bullish shock",
            ]}
            labelFormatter={(label) => {
              const entry = chartData.find((d) => d.driver === label);
              return entry?.fullDriver ?? label;
            }}
          />
          <ReferenceLine x={0} stroke="#e2e8f0" strokeWidth={1.5} strokeDasharray="3 3" />
          <Bar dataKey="negative_swing" fill="#ef4444" fillOpacity={0.85} radius={[0, 3, 3, 0]} isAnimationActive={false}
            label={{ position: "left", fill: "#f87171", fontSize: 10,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter: (v: any) => fp(Math.abs(Number(v)), 0) }}
          />
          <Bar dataKey="positive_swing" fill="#10b981" fillOpacity={0.85} radius={[0, 3, 3, 0]} isAnimationActive={false}
            label={{ position: "right", fill: "#34d399", fontSize: 10,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter: (v: any) => fp(Number(v), 0) }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PDPGrid({ data, currentPrice }: { data: PDPEntry[]; currentPrice: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {data.map((entry) => (
        <div key={entry.driver} className="bg-[#0f172a] rounded-xl p-3">
          <div className="text-xs font-semibold text-slate-300 mb-2">{entry.driver}</div>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={entry.curve} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={`pdp-grad-${entry.driver.replace(/\s/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="driver_value"
                tick={{ fill: "#64748b", fontSize: 9 }}
                tickLine={false}
                tickFormatter={(v) => (v >= 0 ? "+" : "") + v + "%"}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 9 }}
                tickLine={false}
                tickFormatter={(v) => "$" + Number(v).toLocaleString()}
                width={55}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 10 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [fp(Number(v)), "P50 Price"]}
                labelFormatter={(v) => `Driver: ${v >= 0 ? "+" : ""}${v}%`}
              />
              <ReferenceLine y={currentPrice} stroke="#e2e8f0" strokeDasharray="3 3" strokeOpacity={0.4}
                label={{ value: "Current", fill: "#64748b", fontSize: 8, position: "right" }}
              />
              <ReferenceLine x={0} stroke="#475569" strokeDasharray="4 4"
                label={{ value: "Neutral", fill: "#475569", fontSize: 8, position: "top" }}
              />
              <Area
                type="monotone"
                dataKey="expected_price"
                stroke="#f59e0b"
                strokeWidth={1.5}
                fill={`url(#pdp-grad-${entry.driver.replace(/\s/g, "-")})`}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}

function ElasticityRanking({ data }: { data: ElasticityEntry[] }) {
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.elasticity)), 0.0001);
  return (
    <div className="space-y-3">
      {data.map((entry, i) => {
        const barWidth = (Math.abs(entry.elasticity) / maxAbs) * 100;
        const impact = (Math.abs(entry.elasticity) * 10).toFixed(2);
        const isMost = i === 0;
        return (
          <div key={entry.driver} className={`p-3 rounded-xl ${isMost ? "bg-amber-500/8 border border-amber-500/20" : "bg-[#0f172a]"}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono w-4 text-right">{i + 1}.</span>
                <span className="text-sm text-slate-200">{entry.driver}</span>
                {isMost && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">Most Sensitive</span>
                )}
              </div>
              <span className={`text-sm font-mono font-bold ${
                entry.elasticity >= 0 ? "text-emerald-400" : "text-red-400"
              }`}>
                {entry.elasticity >= 0 ? "+" : ""}{entry.elasticity.toFixed(4)}
              </span>
            </div>
            <div className="relative h-1.5 bg-slate-800 rounded-full overflow-hidden mb-1.5">
              <div
                className={`absolute top-0 h-full rounded-full transition-all ${
                  entry.elasticity >= 0 ? "bg-emerald-500" : "bg-red-500"
                }`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              A 10% increase in <span className="text-slate-400">{entry.driver}</span> leads to a ~<span className="font-mono text-slate-300">{impact}%</span> change in expected price
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface SavedScenario {
  name: string;
  drivers: Drivers;
  result: ScenarioResult;
}

export default function ScenarioPage() {
  const { datasets } = useCommodityStore();

  const [selectedId, setSelectedId] = useState("");
  const [horizon, setHorizon] = useState(90);
  const [numSims, setNumSims] = useState(1000);
  const [drivers, setDrivers] = useState<Drivers>({ ...NEUTRAL });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [showSpaghetti, setShowSpaghetti] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [compareResult, setCompareResult] = useState<ScenarioCompareResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [sensitivityResult, setSensitivityResult] = useState<SensitivityResult | null>(null);
  const [isSensLoading, setIsSensLoading] = useState(false);
  const [sensStep, setSensStep] = useState(0);
  const [sensOpen, setSensOpen] = useState(true);
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [replayOpen, setReplayOpen] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [isReplayLoading, setIsReplayLoading] = useState(false);
  const [riskResult, setRiskResult] = useState<RiskMetricsResult | null>(null);
  const [isRiskLoading, setIsRiskLoading] = useState(false);
  const [riskOpen, setRiskOpen] = useState(true);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHistoricalEvents().then(setEvents).catch(() => {});
  }, []);

  const ds = useMemo(() => datasets.find((d) => d.id === selectedId) ?? null, [datasets, selectedId]);

  const closes = useMemo(() => ds?.records.map((r) => r.close) ?? [], [ds]);
  const returns = useMemo(() => logReturns(closes), [closes]);
  const currentPrice = closes[closes.length - 1] ?? 0;
  const vol = useMemo(() => annualVol(returns), [returns]);

  const historical = useMemo(
    () => (ds?.records ?? []).map((r) => ({ date: r.date, price: r.close })),
    [ds]
  );

  const driverShocks = useMemo(
    () =>
      DRIVER_META.map((m) => ({
        name: m.label,
        value: drivers[m.key],
        impact_weight: m.weight,
      })),
    [drivers]
  );

  const handleRun = useCallback(async () => {
    if (!ds || currentPrice <= 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const req: ScenarioRequest = {
        dataset_name: ds.name,
        current_price: currentPrice,
        historical_returns: returns,
        drivers: driverShocks,
        horizon_days: horizon,
        num_simulations: numSims,
        confidence_levels: [0.1, 0.25, 0.5, 0.75, 0.9],
      };
      const res = await runScenario(req);
      setResult(res);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Simulation failed.");
    } finally {
      setIsLoading(false);
    }
  }, [ds, currentPrice, returns, driverShocks, horizon, numSims]);

  const handleSave = useCallback(() => {
    if (!result || !saveName.trim()) return;
    setSavedScenarios((prev) => [...prev, { name: saveName.trim(), drivers: { ...drivers }, result }]);
    setSaveName("");
    setShowSaveInput(false);
  }, [result, saveName, drivers]);

  const handleCompare = useCallback(async () => {
    if (savedScenarios.length < 2 || !ds) return;
    setIsComparing(true);
    try {
      const res = await compareScenarios({
        scenarios: savedScenarios.map((s) => ({
          dataset_name: ds.name,
          current_price: currentPrice,
          historical_returns: returns,
          drivers: DRIVER_META.map((m) => ({
            name: m.label,
            value: s.drivers[m.key],
            impact_weight: m.weight,
          })),
          horizon_days: horizon,
          num_simulations: numSims,
          confidence_levels: [0.1, 0.5, 0.9],
        })),
        scenario_names: savedScenarios.map((s) => s.name),
      });
      setCompareResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setIsComparing(false);
    }
  }, [savedScenarios, ds, currentPrice, returns, horizon, numSims]);

  const expectedReturn = result
    ? ((result.terminal_stats.p50 - result.current_price) / result.current_price) * 100
    : 0;

  const handleRiskMetrics = useCallback(async () => {
    if (!ds || currentPrice <= 0) return;
    setIsRiskLoading(true);
    setRiskResult(null);
    try {
      const histPrices = ds.records.map((r) => ({ date: r.date, close: r.close }));
      const res = await calculateRiskMetrics({
        current_price: currentPrice,
        historical_returns: returns,
        historical_prices: histPrices,
        horizon_days: horizon,
        confidence_levels: [0.95, 0.99],
        num_simulations: 5000,
      });
      setRiskResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Risk metrics calculation failed.");
    } finally {
      setIsRiskLoading(false);
    }
  }, [ds, currentPrice, returns, horizon]);

  const handleApplyEvent = useCallback(async (event: HistoricalEvent) => {
    if (!ds || currentPrice <= 0) return;
    setSelectedEvent(event.id);
    // Populate driver sliders
    const keyMap: Record<string, string> = {
      "Supply Disruption": "supply",
      "Demand Shift": "demand",
      "USD Index Change": "usd",
      "Inventory Change": "inventory",
    };
    const newDrivers = { ...drivers };
    event.drivers.forEach((d) => {
      const k = keyMap[d.name] as keyof typeof newDrivers | undefined;
      if (k !== undefined) newDrivers[k] = d.value;
    });
    setDrivers(newDrivers);

    setIsReplayLoading(true);
    setReplayResult(null);
    try {
      const histData = ds.records.map((r) => ({ date: r.date, close: r.close }));
      const res = await replayEvent({
        event_id: event.id,
        dataset_name: ds.name,
        current_price: currentPrice,
        historical_returns: returns,
        full_historical_data: histData,
      });
      setReplayResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Replay failed.");
    } finally {
      setIsReplayLoading(false);
    }
  }, [ds, currentPrice, returns, drivers]);

  const handleSensitivity = useCallback(async () => {
    if (!ds || currentPrice <= 0) return;
    setIsSensLoading(true);
    setSensStep(0);
    setSensitivityResult(null);
    const stepInterval = setInterval(() => setSensStep((p) => Math.min(p + 1, 3)), 1200);
    try {
      const res = await runSensitivity({
        dataset_name: ds.name,
        current_price: currentPrice,
        historical_returns: returns,
        drivers: driverShocks,
        horizon_days: horizon,
        num_simulations: 500,
      });
      setSensitivityResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sensitivity analysis failed.");
    } finally {
      clearInterval(stepInterval);
      setIsSensLoading(false);
    }
  }, [ds, currentPrice, returns, driverShocks, horizon]);

  const strongestDriver = useMemo(() => {
    const abs = DRIVER_META.map((m) => ({
      label: m.label,
      impact: Math.abs(drivers[m.key] * m.weight * m.sign),
    }));
    abs.sort((a, b) => b.impact - a.impact);
    return abs[0]?.label ?? "—";
  }, [drivers]);

  return (
    <div className="space-y-6 pb-12">
      {/* ── Config Panel ── */}
      <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Dataset + Horizon */}
          <div className="space-y-5">
            <div>
              <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">
                Select Dataset
              </label>
              {datasets.length === 0 ? (
                <p className="text-xs text-commodity-muted">
                  No datasets loaded.{" "}
                  <Link href="/data" className="text-amber-400 underline">Go to Data Hub →</Link>
                </p>
              ) : (
                <div className="relative">
                  <select
                    value={selectedId}
                    onChange={(e) => { setSelectedId(e.target.value); setResult(null); setCompareResult(null); }}
                    className="w-full bg-[#0f172a] border border-commodity-border text-slate-100 text-sm rounded-lg px-3 py-2.5 appearance-none cursor-pointer hover:border-slate-500 transition-colors focus:outline-none focus:border-amber-500/50"
                  >
                    <option value="" className="bg-[#0f172a] text-slate-400">Select dataset…</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id} className="bg-[#0f172a] text-slate-100">
                        {d.name} · {d.source.toUpperCase()} · {d.metadata.rowCount.toLocaleString()} rows
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-commodity-muted pointer-events-none" />
                </div>
              )}
              {ds && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Current Price", val: fp(currentPrice) },
                    { label: "Ann. Volatility", val: vol.toFixed(1) + "%" },
                    { label: "Data Points", val: ds.metadata.rowCount.toLocaleString() },
                  ].map(({ label, val }) => (
                    <div key={label} className="bg-[#0f172a] rounded-lg p-2.5 text-center">
                      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
                      <div className="text-sm font-mono font-semibold text-slate-200">{val}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Horizon */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] text-commodity-muted uppercase tracking-wider">
                  Simulation Horizon
                </label>
                <span className="text-sm font-mono text-amber-400 font-bold">{horizon} days</span>
              </div>
              <input
                type="range"
                min={7}
                max={365}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex gap-2 mt-3">
                {HORIZON_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setHorizon(p.value)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${
                      horizon === p.value
                        ? "bg-amber-500/15 border-amber-500/50 text-amber-400"
                        : "border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Simulations */}
            <div>
              <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">
                Number of Simulations
              </label>
              <div className="flex gap-2">
                {SIM_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setNumSims(n)}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors font-mono ${
                      numSims === n
                        ? "bg-amber-500/15 border-amber-500/50 text-amber-400"
                        : "border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {n >= 1000 ? `${n / 1000}K` : n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5">
                More simulations = smoother results but slower
              </p>
            </div>
          </div>

          {/* Right: Driver Shocks */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Market Driver Assumptions</h3>
              <button
                onClick={() => setDrivers({ ...NEUTRAL })}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Reset to Neutral
              </button>
            </div>

            <div className="space-y-4">
              {DRIVER_META.map((m) => (
                <DriverSlider
                  key={m.key}
                  meta={m}
                  value={drivers[m.key]}
                  onChange={(v) => setDrivers((prev) => ({ ...prev, [m.key]: v }))}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setDrivers({ ...p.values })}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 hover:bg-amber-500/5 transition-all"
                >
                  <span>{p.emoji}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Run Button */}
        <div className="mt-5 pt-5 border-t border-commodity-border">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <button
            onClick={handleRun}
            disabled={isLoading || !ds}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Simulating… this may take a few seconds
              </>
            ) : (
              <>
                <BarChart2 className="w-4 h-4" />
                Run Monte Carlo Simulation ({numSims >= 1000 ? `${numSims / 1000}K` : numSims} paths)
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Results ── */}
      {result && (
        <div ref={resultRef} className="space-y-6">
          {/* Fan Chart */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-200">Price Path Simulation</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {result.num_simulations.toLocaleString()} simulations · {result.horizon_days}-day horizon
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-xs text-slate-400">Show sample paths</span>
                <div
                  onClick={() => setShowSpaghetti((v) => !v)}
                  className={`w-9 h-5 rounded-full relative transition-colors ${showSpaghetti ? "bg-amber-500" : "bg-slate-700"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${showSpaghetti ? "left-4" : "left-0.5"}`} />
                </div>
              </label>
            </div>
            <FanChart result={result} historical={historical} showSpaghetti={showSpaghetti} />
          </div>

          {/* Terminal Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Histogram */}
            <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">Terminal Price Distribution</h2>
              <TerminalHistogram result={result} />
              <p className="text-[10px] text-slate-600 mt-2 text-center">
                <span className="text-red-400 mr-3">■ Below current</span>
                <span className="text-emerald-400">■ Above current</span>
              </p>
            </div>

            {/* Stats Card */}
            <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">Terminal Price Statistics</h2>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: "Mean",        val: fp(result.terminal_stats.mean)   },
                  { label: "Median (P50)",val: fp(result.terminal_stats.p50)    },
                  { label: "Std Dev",     val: fp(result.terminal_stats.std)    },
                  { label: "P10 (Bearish)",val: fp(result.terminal_stats.p10)   },
                  { label: "P90 (Bullish)",val: fp(result.terminal_stats.p90)   },
                  { label: "Min / Max",   val: `${fp(result.terminal_stats.min, 0)} / ${fp(result.terminal_stats.max, 0)}` },
                ].map(({ label, val }) => (
                  <div key={label} className="bg-[#0f172a] rounded-lg p-2.5">
                    <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
                    <div className="text-sm font-mono font-semibold text-slate-200">{val}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0f172a]">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-slate-400">Prob. price increase</span>
                  </div>
                  <span className={`text-sm font-mono font-bold ${result.terminal_stats.prob_above_current >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                    {result.terminal_stats.prob_above_current.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0f172a]">
                  <div className="flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-xs text-slate-400">Prob. price decrease</span>
                  </div>
                  <span className={`text-sm font-mono font-bold ${result.terminal_stats.prob_below_current >= 50 ? "text-red-400" : "text-emerald-400"}`}>
                    {result.terminal_stats.prob_below_current.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <span className="text-xs text-amber-300">Expected Return (P50)</span>
                  <span className={`text-sm font-mono font-bold ${expectedReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {pct(expectedReturn)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── AI Explanation ── */}
          <ExplainButton
            analysisType="scenario"
            resultsSummary={{
              dataset_name: ds?.name,
              current_price: result.current_price,
              horizon_days: result.horizon_days,
              terminal_p10: result.terminal_stats.p10,
              terminal_p50: result.terminal_stats.p50,
              terminal_p90: result.terminal_stats.p90,
              prob_above_current: result.terminal_stats.prob_above_current,
              drivers_applied: result.drivers_applied,
            }}
            datasetNames={ds ? [ds.name] : []}
          />

          {/* Scenario Comparison */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-200">Scenario Comparison</h2>
              <div className="flex items-center gap-2">
                {savedScenarios.length >= 2 && (
                  <button
                    onClick={handleCompare}
                    disabled={isComparing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  >
                    {isComparing ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart2 className="w-3 h-3" />}
                    Compare All
                  </button>
                )}
                <button
                  onClick={() => setShowSaveInput((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  Save Scenario
                </button>
              </div>
            </div>

            {showSaveInput && (
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Scenario name (e.g. Bull Case Q1)…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="flex-1 bg-[#0f172a] border border-commodity-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim()}
                  className="px-4 py-2 text-xs rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold disabled:opacity-40 transition-colors"
                >
                  Save
                </button>
              </div>
            )}

            {savedScenarios.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4">
                Save scenarios to compare them side by side.
              </p>
            ) : (
              <div className="flex gap-3 flex-wrap mb-4">
                {savedScenarios.map((s, i) => (
                  <div
                    key={i}
                    className="bg-[#0f172a] border rounded-xl p-3 min-w-[160px]"
                    style={{ borderColor: SCENARIO_COLORS[i % SCENARIO_COLORS.length] + "40" }}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}
                      />
                      <span className="text-xs font-semibold text-slate-200">{s.name}</span>
                    </div>
                    <div className="text-base font-mono font-bold text-amber-400">
                      {fp(s.result.terminal_stats.p50)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">P50 terminal</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {DRIVER_META.filter((m) => s.drivers[m.key] !== 0).map((m) => (
                        <span key={m.key} className={`text-[9px] px-1 rounded ${s.drivers[m.key] > 0 ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
                          {m.label.split(" ")[0]} {s.drivers[m.key] > 0 ? "+" : ""}{s.drivers[m.key]}%
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {compareResult && (
              <>
                {/* Comparison overlay chart */}
                <div className="mb-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#64748b", fontSize: 10 }}
                        tickFormatter={fmtAxisDate}
                      />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 10 }}
                        tickFormatter={(v) => "$" + Number(v).toLocaleString()}
                        width={65}
                      />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(v: any) => [typeof v === "number" ? fp(v) : String(v ?? "")]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                      {compareResult.scenarios.map((s, i) => {
                        const d = compareResult.forecast_dates.map((date, di) => ({
                          date,
                          [s.name]: s.percentile_paths["P50"]?.[di],
                        }));
                        return (
                          <Line
                            key={s.name}
                            data={d}
                            dataKey={s.name}
                            stroke={SCENARIO_COLORS[i % SCENARIO_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        );
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* Comparison table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-commodity-border">
                        {["Scenario","P10","P50","P90","Exp. Return"].map((h) => (
                          <th key={h} className="text-left py-2 pr-4 text-slate-500 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compareResult.scenarios.map((s, i) => {
                        const ret = ((s.p50_terminal - result.current_price) / result.current_price) * 100;
                        const isBest = s.p50_terminal === Math.max(...compareResult.scenarios.map((x) => x.p50_terminal));
                        return (
                          <tr
                            key={s.name}
                            className={`border-b border-slate-800/50 ${isBest ? "bg-amber-500/5" : ""}`}
                          >
                            <td className="py-2.5 pr-4 font-semibold" style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}>
                              {isBest ? "★ " : ""}{s.name}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-red-400">{fp(s.p10_terminal)}</td>
                            <td className="py-2.5 pr-4 font-mono text-amber-400">{fp(s.p50_terminal)}</td>
                            <td className="py-2.5 pr-4 font-mono text-emerald-400">{fp(s.p90_terminal)}</td>
                            <td className={`py-2.5 font-mono font-bold ${ret >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {pct(ret)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Historical Event Replay */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl overflow-hidden">
            <button
              onClick={() => setReplayOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📅</span>
                <span className="font-semibold text-slate-200">Historical Event Replay</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">What if this happened today?</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${replayOpen ? "rotate-180" : ""}`} />
            </button>

            {replayOpen && (
              <div className="px-5 pb-5 space-y-5">
                {events.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3">Load a dataset to enable event replay.</p>
                ) : (
                  <>
                    {/* Event cards grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                      {events.map((ev) => (
                        <EventCard
                          key={ev.id}
                          event={ev}
                          selected={selectedEvent === ev.id}
                          onApply={() => handleApplyEvent(ev)}
                        />
                      ))}
                    </div>

                    {/* Replay results */}
                    {isReplayLoading && (
                      <div className="flex items-center gap-2 text-sm text-amber-400 py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Running replay simulation…
                      </div>
                    )}

                    {replayResult && !isReplayLoading && (
                      <>
                        {/* Driver impact visual */}
                        <div className="bg-[#0f172a] rounded-xl p-4">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-3">Event Driver Shocks Applied</p>
                          <EventDriverBars drivers={replayResult.event.drivers} />
                        </div>

                        {/* Overlay chart */}
                        <div className="bg-[#0f172a] rounded-xl p-4">
                          <ReplayOverlayChart result={replayResult} eventName={replayResult.event.name} />
                        </div>

                        {/* Comparison card */}
                        {replayResult.simulated_vs_actual && (
                          <ReplayComparisonCard cmp={replayResult.simulated_vs_actual} />
                        )}

                        {/* Terminal stats summary */}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: "P10 Terminal", val: fp(replayResult.simulated.terminal_stats.p10), color: "text-red-400" },
                            { label: "P50 Terminal", val: fp(replayResult.simulated.terminal_stats.p50), color: "text-amber-400" },
                            { label: "P90 Terminal", val: fp(replayResult.simulated.terminal_stats.p90), color: "text-emerald-400" },
                          ].map(({ label, val, color }) => (
                            <div key={label} className="bg-[#0f172a] rounded-xl p-3 text-center">
                              <div className={`text-base font-mono font-bold ${color}`}>{val}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Risk Metrics & Stress Testing */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl overflow-hidden">
            <button
              onClick={() => setRiskOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📊</span>
                <span className="font-semibold text-slate-200">Risk Metrics &amp; Stress Testing</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">VaR · Drawdown · Stress</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${riskOpen ? "rotate-180" : ""}`} />
            </button>

            {riskOpen && (
              <div className="px-5 pb-5 space-y-6">
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-slate-500">
                    VaR, CVaR, historical drawdown and stress scenarios computed from your dataset.
                  </p>
                  <button
                    onClick={handleRiskMetrics}
                    disabled={isRiskLoading || !ds}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40 text-xs font-semibold whitespace-nowrap"
                  >
                    {isRiskLoading ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Calculating…</>
                    ) : (
                      <><TrendingDown className="w-3.5 h-3.5" />Calculate Risk Metrics</>
                    )}
                  </button>
                </div>

                {riskResult && (
                  <>
                    {/* Panel A — VaR Summary */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Panel A — Value at Risk (VaR) &amp; CVaR</h3>
                      <VarSummaryPanel
                        varResults={riskResult.var_results}
                        cvarResults={riskResult.cvar_results}
                        horizon={horizon}
                      />
                    </div>

                    {/* Panel B — Drawdown Chart */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Panel B — Historical Drawdown Analysis</h3>
                      <div className="bg-[#0f172a] rounded-xl p-4">
                        <DrawdownChart drawdown={riskResult.drawdown} />
                      </div>
                    </div>

                    {/* Panel C — Stress Test Matrix */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Panel C — Stress Test Matrix</h3>
                      <div className="bg-[#0f172a] rounded-xl p-4">
                        <StressTestMatrix tests={riskResult.stress_tests} currentPrice={currentPrice} />
                      </div>
                    </div>

                    {/* Panel D — Risk Summary */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Panel D — Risk Summary</h3>
                      <RiskSummaryCard
                        summary={riskResult.risk_summary}
                        maxDrawdownPct={riskResult.drawdown.max_drawdown_pct}
                        datasetName={ds?.name ?? ""}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Sensitivity Analysis */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl overflow-hidden">
            <button
              onClick={() => setSensOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🌪️</span>
                <span className="font-semibold text-slate-200">Sensitivity Analysis</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">Which driver matters most?</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${sensOpen ? "rotate-180" : ""}`} />
            </button>

            {sensOpen && (
              <div className="px-5 pb-5 space-y-5">
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-slate-500">
                    Varies each driver ±30% independently to measure its contribution to price outcome.
                  </p>
                  <button
                    onClick={handleSensitivity}
                    disabled={isSensLoading || !ds}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40 text-xs font-semibold whitespace-nowrap"
                  >
                    {isSensLoading ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Testing each driver… ({sensStep}/4)</>
                    ) : (
                      <><BarChart2 className="w-3.5 h-3.5" />Run Sensitivity Analysis</>
                    )}
                  </button>
                </div>

                {sensitivityResult && (
                  <>
                    {/* Tornado Chart */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Tornado Chart — Price Sensitivity to Driver Shocks</h3>
                      <TornadoChart data={sensitivityResult.tornado} baselinePrice={sensitivityResult.baseline_price} />
                    </div>

                    {/* Partial Dependence Plots */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Partial Dependence — Driver Value → Expected Price</h3>
                      <PDPGrid data={sensitivityResult.partial_dependence} currentPrice={sensitivityResult.current_price} />
                    </div>

                    {/* Elasticity Ranking */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Elasticity Ranking</h3>
                      <ElasticityRanking data={sensitivityResult.elasticities} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Interpretation Card */}
          <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Simulation Interpretation</h2>
            <div className="space-y-2 text-sm text-slate-400 leading-relaxed">
              <p>
                Based on <span className="text-slate-200 font-mono">{result.num_simulations.toLocaleString()}</span> Monte Carlo simulations over{" "}
                <span className="text-slate-200 font-mono">{result.horizon_days} days</span>:
              </p>
              <p>
                The median price forecast is{" "}
                <span className="text-amber-400 font-mono font-semibold">{fp(result.terminal_stats.p50)}</span>
                {" "}(
                <span className={expectedReturn >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {pct(expectedReturn)}
                </span>{" "}
                from current {fp(result.current_price)}).
              </p>
              <p>
                There is a{" "}
                <span className={result.terminal_stats.prob_above_current >= 50 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                  {result.terminal_stats.prob_above_current.toFixed(1)}%
                </span>{" "}
                probability of the price increasing from current levels.
              </p>
              <p>
                The 80% confidence range is{" "}
                <span className="text-slate-200 font-mono">{fp(result.terminal_stats.p10)}</span>
                {" "}—{" "}
                <span className="text-slate-200 font-mono">{fp(result.terminal_stats.p90)}</span>
                , a spread of{" "}
                <span className="text-slate-200 font-mono">{fp(result.terminal_stats.p90 - result.terminal_stats.p10)}</span>.
              </p>
              <p>
                Key driver impact:{" "}
                <span className="text-amber-400">{strongestDriver}</span> has the largest effect on price outcome.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-commodity-border grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Historical Volatility", val: result.model_params.annualized_vol.toFixed(2) + "%" },
                { label: "Base Daily Drift", val: (result.model_params.base_mu * 100).toFixed(4) + "%" },
                { label: "Adjusted Daily Drift", val: (result.model_params.adjusted_mu * 100).toFixed(4) + "%" },
                { label: "Simulated Paths", val: result.num_simulations.toLocaleString() },
              ].map(({ label, val }) => (
                <div key={label} className="bg-[#0f172a] rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-500 mb-1">{label}</div>
                  <div className="text-sm font-mono font-semibold text-slate-300">{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
