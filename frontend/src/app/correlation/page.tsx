"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Link2, AlertCircle, Loader2, Info,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, BarChart, Bar, Cell, Legend,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { useCommodityStore } from "@/lib/store";
import { runCorrelation, runRollingCorrelation, runRegimeScatter, runCrossLag, runCorrelationAlerts, runGrangerCausality } from "@/lib/api";
import type {
  CorrelationResult, CorrelationPair,
  RollingCorrelationResult, RegimeScatterResult, CrossLagResult,
  CorrelationAlertResult, AlertPeriod, GrangerResult,
} from "@/lib/types";
import ExplainButton from "@/components/ui/ExplainButton";

// ── Constants ───────────────────────────────────────────────────────────────────

const WINDOW_COLORS: Record<string, string> = {
  "30": "#f59e0b",
  "60": "#3b82f6",
  "90": "#a78bfa",
};

const PERIOD_OPTIONS = [
  { value: "full", label: "Full" },
  { value: "3y",   label: "3Y"   },
  { value: "2y",   label: "2Y"   },
  { value: "1y",   label: "1Y"   },
  { value: "ytd",  label: "YTD"  },
] as const;

const PERIOD_LABELS: Record<string, string> = {
  full: "full history", "1y": "1 year", "2y": "2 years",
  "3y": "3 years", ytd: "year-to-date",
};

// ── Color helpers ────────────────────────────────────────────────────────────────

function getCorrelationBg(v: number, isDiag: boolean): string {
  if (isDiag) return "#374151";
  if (v >=  0.9) return "#1e3a8a";
  if (v >=  0.7) return "#1d4ed8";
  if (v >=  0.5) return "#2563eb";
  if (v >=  0.3) return "#93c5fd";
  if (v >=  0.1) return "#bfdbfe";
  if (v >= -0.1) return "#e2e8f0";
  if (v >= -0.3) return "#fca5a5";
  if (v >= -0.5) return "#f87171";
  if (v >= -0.7) return "#dc2626";
  return "#7f1d1d";
}

function getTextColor(v: number, isDiag: boolean): string {
  if (isDiag) return "#9ca3af";
  const a = Math.abs(v);
  if (a >= 0.5) return "#ffffff";
  if (a >= 0.3) return "#1e293b";
  return "#334155";
}

function corrColor(v: number): string {
  if (v >  0.5) return "#10b981";
  if (v < -0.5) return "#3b82f6";
  return "#94a3b8";
}

function sigStars(p: number): string {
  if (p < 0.001) return "***";
  if (p < 0.01)  return "**";
  if (p < 0.05)  return "*";
  return "";
}

function fmtAxisDate(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  return `${d.toLocaleString("default", { month: "short" })} '${String(d.getFullYear()).slice(2)}`;
}

function truncName(s: string, n = 12): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function cellSize(n: number): number {
  if (n <= 3) return 120;
  if (n <= 5) return 100;
  if (n <= 7) return 85;
  return 72;
}

// ── Sub-components ───────────────────────────────────────────────────────────────

function HeatmapGrid({
  result, selectedCell, onCellClick,
}: {
  result: CorrelationResult;
  selectedCell: [number, number] | null;
  onCellClick: (row: number, col: number) => void;
}) {
  const { columns, values } = result.correlation_matrix;
  const pVals = result.p_value_matrix.values;
  const cs = cellSize(columns.length);
  const headerH = 56;

  return (
    <div className="overflow-x-auto">
      <div style={{ display: "inline-block", minWidth: "fit-content" }}>
        {/* Column headers */}
        <div style={{ display: "flex", marginLeft: cs + 8 }}>
          {columns.map((name, j) => (
            <div
              key={j}
              style={{ width: cs, flexShrink: 0, height: headerH, position: "relative", overflow: "hidden" }}
              className="flex items-end justify-center pb-2"
            >
              <span
                className="text-[10px] text-commodity-muted/70 font-mono"
                style={{
                  transform: "rotate(-45deg)",
                  transformOrigin: "bottom center",
                  display: "block",
                  whiteSpace: "nowrap",
                  position: "absolute",
                  bottom: 6,
                  left: "50%",
                }}
                title={name}
              >
                {truncName(name, 10)}
              </span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {columns.map((rowName, i) => (
          <div key={i} style={{ display: "flex", marginBottom: 2 }}>
            {/* Row label */}
            <div
              style={{ width: cs, flexShrink: 0 }}
              className="flex items-center justify-end pr-2 text-[10px] text-commodity-muted/70 font-mono"
              title={rowName}
            >
              {truncName(rowName, 10)}
            </div>

            {/* Cells */}
            {columns.map((_, j) => {
              const v      = values[i][j];
              const p      = pVals[i][j];
              const isDiag = i === j;
              const isInsig = !isDiag && p > 0.05;
              const bg     = getCorrelationBg(v, isDiag);
              const tc     = getTextColor(v, isDiag);
              const isSel  = !isDiag && selectedCell?.[0] === i && selectedCell?.[1] === j;

              return (
                <button
                  key={j}
                  onClick={() => !isDiag && onCellClick(i, j)}
                  disabled={isDiag}
                  style={{
                    width: cs,
                    height: cs,
                    flexShrink: 0,
                    backgroundColor: bg,
                    color: tc,
                    border: isSel ? "3px solid #f59e0b" : "1px solid #334155",
                    borderRadius: 4,
                    marginRight: 2,
                    cursor: isDiag ? "default" : "pointer",
                    position: "relative",
                    transition: "transform 0.1s",
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: cs >= 100 ? 13 : 11,
                    fontWeight: 600,
                    opacity: isInsig ? 0.55 : 1,
                    outline: "none",
                  }}
                  className="hover:scale-105 focus:outline-none"
                  title={isDiag ? rowName : `${columns[i]} vs ${columns[j]}: r=${v.toFixed(4)}, p=${p.toFixed(4)}`}
                >
                  <span style={{ textDecoration: isInsig ? "line-through" : "none" }}>
                    {isDiag ? "1.00" : v.toFixed(2)}
                  </span>
                  {!isDiag && (
                    <span style={{ fontSize: 8, position: "absolute", top: 2, right: 3, opacity: 0.85 }}>
                      {sigStars(p)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-4 flex-wrap">
        {[
          { label: "Strong neg (< −0.5)", color: "#7f1d1d" },
          { label: "Weak neg",             color: "#fca5a5" },
          { label: "~Zero",                color: "#e2e8f0" },
          { label: "Weak pos",             color: "#bfdbfe" },
          { label: "Strong pos (> 0.5)",   color: "#1d4ed8" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm border border-commodity-border/50" style={{ background: color }} />
            <span className="text-[10px] text-commodity-muted/50">{label}</span>
          </div>
        ))}
        <span className="text-[10px] text-commodity-muted/40 ml-2">* p&lt;0.05  ** p&lt;0.01  *** p&lt;0.001 | strikethrough = not significant</span>
      </div>
    </div>
  );
}

function RollingChart({ result }: { result: RollingCorrelationResult }) {
  const { historical_stats: hs, asset_a_name: na, asset_b_name: nb } = result;
  const upper2s = hs.mean + 2 * hs.std;
  const lower2s = hs.mean - 2 * hs.std;

  const chartData = useMemo(() => {
    const map: Record<string, { date: string; d30?: number; d60?: number; d90?: number }> = {};
    (["30", "60", "90"] as const).forEach((w) => {
      (result.rolling_data[w] ?? []).forEach((pt) => {
        if (!map[pt.date]) map[pt.date] = { date: pt.date };
        if (w === "30") map[pt.date].d30 = pt.correlation;
        if (w === "60") map[pt.date].d60 = pt.correlation;
        if (w === "90") map[pt.date].d90 = pt.correlation;
      });
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [result.rolling_data]);

  return (
    <div>
      <p className="text-[10px] text-commodity-muted/50 mb-3 font-mono">
        {na} vs {nb} — rolling correlation by window
      </p>
      <ResponsiveContainer width="100%" height={310}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: "#64748b" }}
            axisLine={false} tickLine={false}
            tickFormatter={fmtAxisDate}
            minTickGap={60}
          />
          <YAxis
            domain={[-1, 1]}
            tick={{ fontSize: 9, fill: "#64748b" }}
            axisLine={false} tickLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
            width={28}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#94a3b8", marginBottom: 4 }}
            formatter={((v: unknown, name: unknown) => [(v as number)?.toFixed(4) ?? String(v), String(name)]) as never}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 8 }}
            formatter={(v: string) => ({ "d30": "30D", "d60": "60D", "d90": "90D" }[v] ?? v)}
          />
          {/* Reference lines */}
          <ReferenceLine y={0}          stroke="#475569" strokeDasharray="4 4" />
          <ReferenceLine y={hs.mean}    stroke="#e2e8f0" strokeDasharray="3 3" strokeWidth={0.8}
            label={{ value: `Mean ${hs.mean.toFixed(2)}`, position: "right", fontSize: 9, fill: "#94a3b8" }} />
          <ReferenceLine y={upper2s}    stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} />
          <ReferenceLine y={lower2s}    stroke="#ef4444" strokeDasharray="2 3" strokeWidth={0.8} />
          <ReferenceLine y={ 0.5}       stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
          <ReferenceLine y={-0.5}       stroke="#3b82f6" strokeDasharray="2 4" strokeOpacity={0.4} />
          <Line type="monotone" dataKey="d30" stroke={WINDOW_COLORS["30"]} strokeWidth={1.2}
            dot={false} name="d30" isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="d60" stroke={WINDOW_COLORS["60"]} strokeWidth={1.8}
            dot={false} name="d60" isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="d90" stroke={WINDOW_COLORS["90"]} strokeWidth={2.2}
            dot={false} name="d90" isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Histogram({ result }: { result: RollingCorrelationResult }) {
  const current = result.historical_stats.current;
  const BINS = 20;
  const histData = useMemo(() => {
    const pts = (result.rolling_data["60"] ?? []).map((p) => p.correlation);
    const step = 2 / BINS;
    const counts = new Array(BINS).fill(0);
    pts.forEach((v) => {
      const idx = Math.min(Math.floor((v + 1) / step), BINS - 1);
      counts[idx]++;
    });
    return counts.map((count, i) => ({
      bin: -1 + i * step + step / 2,
      count,
      label: (-1 + i * step).toFixed(1),
    }));
  }, [result.rolling_data]);

  const currentBin = Math.min(Math.floor((current + 1) / (2 / BINS)), BINS - 1);

  return (
    <div>
      <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1.5">
        60-Day Correlation Distribution
      </p>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={histData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }} barCategoryGap={1}>
          <XAxis dataKey="label" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
          <YAxis hide />
          <ReferenceLine
            x={histData[currentBin]?.label}
            stroke="#f59e0b"
            strokeWidth={2}
            label={{ value: "now", position: "top", fontSize: 8, fill: "#f59e0b" }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {histData.map((entry, i) => (
              <Cell
                key={i}
                fill={i === currentBin ? "#f59e0b" : entry.bin > 0 ? "#c2410c60" : "#3b82f660"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PairStats({ result }: { result: RollingCorrelationResult }) {
  const hs = result.historical_stats;
  const pct = hs.percentile_current;
  const isUnusuallyHigh = pct > 90;
  const isUnusuallyLow  = pct < 10;

  const pctLabel = isUnusuallyHigh
    ? "Unusually high ⚠"
    : isUnusuallyLow
    ? "Unusually low ⚠"
    : `${pct.toFixed(0)}th percentile`;

  const rows = [
    { label: "Current",     value: hs.current.toFixed(4),  highlight: true },
    { label: "Mean",        value: hs.mean.toFixed(4)       },
    { label: "Std Dev",     value: `±${hs.std.toFixed(4)}`  },
    { label: "Min",         value: hs.min.toFixed(4)        },
    { label: "Max",         value: hs.max.toFixed(4)        },
    { label: "Percentile",  value: pctLabel, warn: isUnusuallyHigh || isUnusuallyLow },
  ];

  const currentRegime = result.regimes[result.regimes.length - 1];

  return (
    <div className="space-y-3">
      <div className="text-center mb-3">
        <p className="text-[10px] text-commodity-muted/50 uppercase tracking-wider mb-1">Current Correlation</p>
        <p
          className="text-3xl font-mono font-bold"
          style={{ color: corrColor(hs.current) }}
        >
          {hs.current >= 0 ? "+" : ""}{hs.current.toFixed(3)}
        </p>
        {currentRegime && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block ${
            currentRegime.regime === "high"   ? "bg-amber-500/15 text-amber-400"   :
            currentRegime.regime === "low"    ? "bg-blue-500/15 text-blue-400"     :
            "bg-slate-500/15 text-slate-400"
          }`}>
            {currentRegime.regime.toUpperCase()} REGIME
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {rows.map(({ label, value, highlight, warn }) => (
          <div key={label} className="flex justify-between items-center">
            <span className="text-[11px] text-commodity-muted/50">{label}</span>
            <span className={`text-[11px] font-mono font-medium ${
              highlight ? `font-bold` : warn ? "text-red-400" : "text-commodity-text"
            }`} style={highlight ? { color: corrColor(hs.current) } : undefined}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InterpretCard({ result }: { result: CorrelationResult }) {
  const top = result.top_correlations[0];
  const bot = result.bottom_correlations[0];
  const insig = result.top_correlations.concat(result.bottom_correlations).filter((p) => !p.significant).length;
  const allPairs = result.top_correlations.concat(result.bottom_correlations);
  const avgAbsCorr = allPairs.reduce((s, p) => s + Math.abs(p.correlation), 0) / (allPairs.length || 1);

  const pattern = avgAbsCorr > 0.6
    ? "highly co-moving — diversification within this basket is limited"
    : avgAbsCorr > 0.35
    ? "moderately correlated — some diversification exists"
    : "relatively independent — this basket offers good diversification";

  const pca = result.pca_summary;

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5 space-y-2.5">
      <h3 className="text-xs font-semibold text-commodity-text uppercase tracking-wider mb-3 flex items-center gap-2">
        <Info className="w-3.5 h-3.5 text-amber-400" />
        Interpretation
      </h3>
      <p className="text-sm text-commodity-muted/80 leading-relaxed">
        The correlation matrix shows assets that are <strong className="text-commodity-text">{pattern}</strong>.{" "}
        {pca.interpretation}
      </p>
      {top && (
        <p className="text-sm text-commodity-muted/80 leading-relaxed">
          <strong className="text-commodity-text">Strongest relationship:</strong>{" "}
          {top.pair} ({top.correlation >= 0 ? "+" : ""}{top.correlation.toFixed(3)}
          {sigStars(top.p_value) ? ` ${sigStars(top.p_value)}` : ""}) — these assets tend to move{" "}
          <strong className="text-commodity-text">{top.correlation >= 0 ? "together" : "inversely"}</strong>.
        </p>
      )}
      {bot && (
        <p className="text-sm text-commodity-muted/80 leading-relaxed">
          <strong className="text-commodity-text">Weakest relationship:</strong>{" "}
          {bot.pair} ({bot.correlation >= 0 ? "+" : ""}{bot.correlation.toFixed(3)}) — these assets are{" "}
          <strong className="text-commodity-text">relatively independent</strong>.
        </p>
      )}
      <p className="text-sm text-commodity-muted/80 leading-relaxed">
        Method: <strong className="text-commodity-text">{result.method.charAt(0).toUpperCase() + result.method.slice(1)}</strong>{" "}
        on <strong className="text-commodity-text">{result.used_returns ? "log-returns" : "raw prices"}</strong> —{" "}
        <strong className="text-commodity-text">{result.num_observations}</strong> aligned observations
        ({result.period_start} → {result.period_end}).
      </p>
      {insig > 0 && (
        <p className="text-sm text-amber-400/70 leading-relaxed">
          ⚠ {insig} pair(s) show statistically insignificant correlation (p &gt; 0.05, marked with strikethrough in matrix).
        </p>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────────

export default function CorrelationPage() {
  const { datasets } = useCommodityStore();

  const [method, setMethod]           = useState<"pearson" | "spearman">("pearson");
  const [useReturns, setUseReturns]   = useState(true);
  const [period, setPeriod]           = useState("full");
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [result, setResult]           = useState<CorrelationResult | null>(null);

  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [rollingResult, setRollingResult] = useState<RollingCorrelationResult | null>(null);
  const [rollingLoading, setRollingLoading] = useState(false);
  const [rollingError, setRollingError]     = useState<string | null>(null);

  const [regimeResult, setRegimeResult]     = useState<RegimeScatterResult | null>(null);
  const [regimeLoading, setRegimeLoading]   = useState(false);
  const [crossLagResult, setCrossLagResult] = useState<CrossLagResult | null>(null);
  const [crossLagLoading, setCrossLagLoading] = useState(false);
  const [enhancedError, setEnhancedError]   = useState<string | null>(null);

  const [alertResult, setAlertResult]       = useState<CorrelationAlertResult | null>(null);
  const [alertLoading, setAlertLoading]     = useState(false);

  const [grangerResult, setGrangerResult]   = useState<GrangerResult | null>(null);
  const [grangerLoading, setGrangerLoading] = useState(false);
  const [grangerError, setGrangerError]     = useState<string | null>(null);
  const [grangerMaxLag, setGrangerMaxLag]   = useState(10);
  const [grangerSig, setGrangerSig]         = useState(0.05);

  const drilldownRef = useRef<HTMLDivElement>(null);

  const canRun = datasets.length >= 2;

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setSelectedCell(null);
    setRollingResult(null);
    setRegimeResult(null);
    setCrossLagResult(null);
    setAlertResult(null);
    setGrangerResult(null);

    const reqDatasets = datasets.map((ds) => ({
      name: ds.name,
      dates:  ds.records.map((r) => r.date),
      values: ds.records.map((r) => r.close),
    }));

    try {
      const res = await runCorrelation({ datasets: reqDatasets, method, use_returns: useReturns, period: period as "full" | "1y" | "2y" | "3y" | "ytd" });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Correlation analysis failed.");
    } finally {
      setIsLoading(false);
    }

    // Auto-run alerts in background
    setAlertLoading(true);
    runCorrelationAlerts({ datasets: reqDatasets, use_returns: useReturns })
      .then(setAlertResult).catch(() => null)
      .finally(() => setAlertLoading(false));
  }, [datasets, method, useReturns, period, canRun]);

  const handleCellClick = useCallback(async (row: number, col: number) => {
    if (!result) return;
    setSelectedCell([row, col]);
    setRollingResult(null);
    setRollingError(null);
    setRollingLoading(true);

    const cols = result.correlation_matrix.columns;
    const nameA = cols[row];
    const nameB = cols[col];

    const dsA = datasets.find((d) => d.name === nameA);
    const dsB = datasets.find((d) => d.name === nameB);

    if (!dsA || !dsB) {
      setRollingError("Could not find dataset data for selected pair.");
      setRollingLoading(false);
      return;
    }

    try {
      const res = await runRollingCorrelation({
        asset_a: { name: nameA, dates: dsA.records.map((r) => r.date), values: dsA.records.map((r) => r.close) },
        asset_b: { name: nameB, dates: dsB.records.map((r) => r.date), values: dsB.records.map((r) => r.close) },
        window_sizes: [30, 60, 90],
        use_returns: useReturns,
      });
      setRollingResult(res);
      setTimeout(() => drilldownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e: unknown) {
      setRollingError(e instanceof Error ? e.message : "Rolling correlation failed.");
    } finally {
      setRollingLoading(false);
    }

    // Kick off regime + cross-lag in parallel (non-blocking)
    setRegimeResult(null);
    setCrossLagResult(null);
    setEnhancedError(null);
    setRegimeLoading(true);
    setCrossLagLoading(true);
    const assetA = { name: nameA, dates: datasets.find((d) => d.name === nameA)!.records.map((r) => r.date), values: datasets.find((d) => d.name === nameA)!.records.map((r) => r.close) };
    const assetB = { name: nameB, dates: datasets.find((d) => d.name === nameB)!.records.map((r) => r.date), values: datasets.find((d) => d.name === nameB)!.records.map((r) => r.close) };
    Promise.all([
      runRegimeScatter({ asset_a: assetA, asset_b: assetB }).then(setRegimeResult).catch(() => null),
      runCrossLag({ asset_a: assetA, asset_b: assetB }).then(setCrossLagResult).catch(() => null),
    ]).catch((e) => setEnhancedError(e instanceof Error ? e.message : "Enhanced analysis failed."))
      .finally(() => { setRegimeLoading(false); setCrossLagLoading(false); });
  }, [result, datasets, useReturns]);

  const selectedPairName = useMemo(() => {
    if (!selectedCell || !result) return null;
    const cols = result.correlation_matrix.columns;
    return `${cols[selectedCell[0]]} vs ${cols[selectedCell[1]]}`;
  }, [selectedCell, result]);

  const explainSummary = useMemo(() => {
    if (!result) return {};
    return {
      method: result.method,
      used_returns: result.used_returns,
      period_start: result.period_start,
      period_end: result.period_end,
      num_observations: result.num_observations,
      top_correlations: result.top_correlations,
      bottom_correlations: result.bottom_correlations,
      pca_summary: result.pca_summary,
    };
  }, [result]);

  const handleRunGranger = useCallback(async () => {
    if (!canRun) return;
    setGrangerLoading(true);
    setGrangerError(null);
    setGrangerResult(null);
    const reqDatasets = datasets.map((ds) => ({
      name: ds.name,
      dates:  ds.records.map((r) => r.date),
      values: ds.records.map((r) => r.close),
    }));
    try {
      const res = await runGrangerCausality({ datasets: reqDatasets, max_lag: grangerMaxLag, significance: grangerSig });
      setGrangerResult(res);
    } catch (e: unknown) {
      setGrangerError(e instanceof Error ? e.message : "Granger causality test failed.");
    } finally {
      setGrangerLoading(false);
    }
  }, [canRun, datasets, grangerMaxLag, grangerSig, useReturns]);

  // ── Regime Scatter ──────────────────────────────────────────────────────────

  const REGIME_COLORS: Record<string, string> = { Low: "#22c55e", Medium: "#f59e0b", High: "#ef4444" };
  const REGIME_SIZES:  Record<string, number>  = { Low: 3, Medium: 4, High: 5 };

  function RegimeScatterSection({ rs, nameA, nameB }: {
    rs: RegimeScatterResult; nameA: string; nameB: string;
  }) {
    const byRegime = useMemo(() => {
      const groups: Record<string, { x: number; y: number; date: string }[]> = { Low: [], Medium: [], High: [] };
      for (const pt of rs.scatter_data) groups[pt.regime]?.push({ x: pt.x * 100, y: pt.y * 100, date: pt.date });
      return groups;
    }, [rs]);

    const corrCard = (regime: "Low" | "Medium" | "High") => {
      const rc = rs.regime_correlations[regime];
      const rr = rs.regime_regressions[regime];
      if (!rc) return null;
      const c = rc.correlation;
      const pct = Math.round(rc.pct_of_total * 100);
      const col = REGIME_COLORS[regime];
      const highLow = rs.regime_correlations["High"]?.correlation;
      const lowLow  = rs.regime_correlations["Low"]?.correlation;
      const stressAlert = regime === "High" && highLow !== undefined && lowLow !== undefined && highLow - lowLow > 0.2;
      return (
        <div key={regime} className="bg-commodity-panel rounded-xl p-4 border border-commodity-border/60 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-commodity-text">{regime} Volatility</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${col}20`, color: col }}>{regime}</span>
          </div>
          <p className="text-2xl font-bold font-mono" style={{ color: c > 0.5 ? "#10b981" : c < -0.5 ? "#3b82f6" : "#94a3b8" }}>
            {c >= 0 ? "+" : ""}{c.toFixed(3)}
          </p>
          <p className="text-[10px] text-commodity-muted/60">{rc.num_observations} obs ({pct}% of data)</p>
          {rr && <p className="text-[10px] text-commodity-muted/50">R² = {rr.r_squared.toFixed(3)}</p>}
          {stressAlert && (
            <div className="flex items-start gap-1.5 mt-1 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px]">
              ⚠️ Correlation increases during stress — diversification weakens when needed most
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="bg-commodity-panel rounded-xl p-4">
          <h3 className="text-xs font-semibold text-commodity-text mb-1">
            Regime Scatter: <span className="text-amber-400">{nameA}</span> vs <span className="text-amber-400">{nameB}</span>
          </h3>
          <p className="text-[10px] text-commodity-muted/50 mb-3 font-mono">
            Points colored by {rs.regime_thresholds ? `rolling volatility regime (low vol ≤ ${(rs.regime_thresholds.low_vol * 100).toFixed(3)}%, high vol ≥ ${(rs.regime_thresholds.high_vol * 100).toFixed(3)}%)` : "volatility regime"}
          </p>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                type="number" dataKey="x" name={nameA}
                tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                label={{ value: `${nameA} return (%)`, position: "insideBottom", offset: -12, fontSize: 10, fill: "#64748b" }}
              />
              <YAxis
                type="number" dataKey="y" name={nameB}
                tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                label={{ value: `${nameB} return (%)`, angle: -90, position: "insideLeft", offset: 16, fontSize: 10, fill: "#64748b" }}
              />
              <ZAxis range={[16, 40]} />
              <ReferenceLine x={0} stroke="#334155" strokeDasharray="4 4" />
              <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={((v: unknown, name: unknown) => [`${(v as number).toFixed(3)}%`, String(name)]) as never}
              />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8, color: "#94a3b8" }}
                formatter={(v: string) => {
                  const rc = rs.regime_correlations[v];
                  return `${v} Vol${rc ? ` (r=${rc.correlation.toFixed(2)})` : ""}`;
                }}
              />
              {(["Low", "Medium", "High"] as const).map((regime) => (
                <Scatter
                  key={regime}
                  name={regime}
                  data={byRegime[regime]}
                  fill={REGIME_COLORS[regime]}
                  fillOpacity={0.65}
                  r={REGIME_SIZES[regime]}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Regime correlation cards */}
        <div className="grid grid-cols-3 gap-3">
          {(["Low", "Medium", "High"] as const).map(corrCard)}
        </div>
      </div>
    );
  }

  // ── Cross-Lag ────────────────────────────────────────────────────────────────

  function CrossLagSection({ cl, nameA, nameB }: {
    cl: CrossLagResult; nameA: string; nameB: string;
  }) {
    const opt = cl.optimal_lag;
    const optAbs = Math.abs(opt.lag);
    const leader   = opt.lag > 0 ? nameA : opt.lag < 0 ? nameB : null;
    const follower = opt.lag > 0 ? nameB : opt.lag < 0 ? nameA : null;
    const strength = Math.abs(opt.correlation) > 0.3 ? "strong" : Math.abs(opt.correlation) < 0.1 ? "weak" : "moderate";
    const strengthColor = strength === "strong" ? "#f59e0b" : strength === "weak" ? "#64748b" : "#94a3b8";

    return (
      <div className="space-y-4">
        <div className="bg-commodity-panel rounded-xl p-4">
          <h3 className="text-xs font-semibold text-commodity-text mb-1">Cross-Correlation by Lag</h3>
          <p className="text-[10px] text-commodity-muted/50 mb-3 font-mono">
            Positive lag: {nameA} leads {nameB} &nbsp;|&nbsp; Negative lag: {nameB} leads {nameA}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cl.cross_correlations} margin={{ top: 4, right: 16, bottom: 20, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="lag" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
                interval={Math.floor(cl.cross_correlations.length / 10)}
                label={{ value: "Lag (days)", position: "insideBottom", offset: -12, fontSize: 10, fill: "#64748b" }}
              />
              <YAxis
                domain={[-1, 1]} tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => v.toFixed(1)} width={28}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={((v: unknown) => [(v as number).toFixed(4), "Correlation"]) as never}
                labelFormatter={((l: unknown) => `Lag: ${(l as number) > 0 ? "+" : ""}${l} days`) as never}
              />
              <Bar dataKey="correlation" maxBarSize={14}>
                {cl.cross_correlations.map((entry) => {
                  const isOpt = entry.lag === opt.lag;
                  const col = isOpt ? "#ffffff" : entry.lag > 0 ? "#f59e0b" : entry.lag < 0 ? "#3b82f6" : "#94a3b8";
                  return <Cell key={entry.lag} fill={col} opacity={isOpt ? 1 : 0.75} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[9px] text-center text-commodity-muted/40 mt-1">
            ← {nameB} leads &nbsp;|&nbsp; {nameA} leads →
          </p>
        </div>

        {/* Lead-lag insight card */}
        <div className="bg-commodity-panel rounded-xl p-4 border border-commodity-border/60 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-semibold text-commodity-text">Lead-Lag Insight</h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${strengthColor}20`, color: strengthColor }}>
              {strength.charAt(0).toUpperCase() + strength.slice(1)} signal
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1">Optimal Lag</p>
              <p className="text-lg font-bold font-mono text-amber-400">
                {opt.lag > 0 ? "+" : ""}{opt.lag} <span className="text-xs text-commodity-muted">days</span>
              </p>
            </div>
            <div>
              <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1">Lag Correlation</p>
              <p className="text-lg font-bold font-mono" style={{ color: strengthColor }}>
                {opt.correlation >= 0 ? "+" : ""}{opt.correlation.toFixed(4)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-commodity-muted/80 leading-relaxed">{opt.interpretation}</p>
          {opt.lag !== 0 && leader && follower && (
            <div className="p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/15 text-[10px] text-amber-400/80">
              Trading implication: A trader could potentially use{" "}
              <span className="font-semibold text-amber-400">{leader}</span> price movements as a{" "}
              <span className="font-semibold text-amber-400">{optAbs}-day</span> early signal for{" "}
              <span className="font-semibold text-amber-400">{follower}</span>.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Alerts Section ───────────────────────────────────────────────────────────

  function AlertsSection({ ar, selectedPair }: { ar: CorrelationAlertResult; selectedPair: string | null }) {
    const allAlerts = useMemo(() => {
      const rows: Array<{ pair: string; period: AlertPeriod; isCurrent: boolean }> = [];
      for (const pa of ar.pair_alerts) {
        for (const ap of pa.alerts) {
          rows.push({ pair: pa.pair, period: ap, isCurrent: pa.current_status === "alert" });
        }
      }
      return rows.sort((a, b) => b.period.start.localeCompare(a.period.start));
    }, [ar]);

    const daysBetween = (start: string, end: string) => {
      const ms = new Date(end).getTime() - new Date(start).getTime();
      return Math.round(ms / 86400000);
    };

    return (
      <div className="space-y-4">
        {/* Active alerts banner */}
        {ar.currently_anomalous.length > 0 ? (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-400 mb-1">
                ⚠️ {ar.currently_anomalous.length} correlation {ar.currently_anomalous.length === 1 ? "anomaly" : "anomalies"} detected
              </p>
              <div className="space-y-0.5">
                {ar.currently_anomalous.map((pa) => (
                  <p key={pa.pair} className="text-[11px] text-red-300/80">
                    <span className="font-semibold">{pa.pair}</span>: correlation is unusually{" "}
                    {pa.current_z_score > 0 ? "high" : "low"} (z-score: {pa.current_z_score >= 0 ? "+" : ""}{pa.current_z_score.toFixed(2)})
                  </p>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-green-500/10 border border-green-500/25">
            <span className="text-green-400 text-sm">✅ All correlations within normal range</span>
            <span className="text-[10px] text-commodity-muted/50 ml-auto font-mono">{ar.total_alert_count} historical alerts found</span>
          </div>
        )}

        {/* Alert history table */}
        {allAlerts.length > 0 && (
          <div className="bg-commodity-panel rounded-xl overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-xs font-semibold text-commodity-text">Alert History</h3>
              {ar.most_unstable_pair && (
                <p className="text-[10px] text-commodity-muted/50 mt-0.5">
                  Most unstable pair: <span className="text-amber-400">{ar.most_unstable_pair.pair}</span> ({(ar.most_unstable_pair as {alerts?: unknown[]}).alerts?.length ?? 0} alerts)
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-commodity-border/60">
                    {["Pair", "Period", "Type", "Duration", "Peak |Z|", "Corr During", "Normal Corr"].map((h) => (
                      <th key={h} className="text-left px-4 py-2 text-[9px] text-commodity-muted/40 uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allAlerts.slice(0, 20).map(({ pair, period, isCurrent }, i) => (
                    <tr
                      key={i}
                      className={`border-b border-commodity-border/30 hover:bg-commodity-card/40 transition-colors ${
                        isCurrent ? "bg-amber-500/5" : ""
                      } ${pair === selectedPair ? "bg-blue-500/5" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium text-commodity-text">{pair}</td>
                      <td className="px-4 py-2 font-mono text-commodity-muted/70">{period.start} — {period.end}</td>
                      <td className="px-4 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          period.direction === "breakdown"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-amber-500/20 text-amber-400"
                        }`}>
                          {period.direction === "breakdown" ? "Breakdown" : "Spike"}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-commodity-muted/70">{daysBetween(period.start, period.end)}d</td>
                      <td className="px-4 py-2 font-mono text-commodity-text">{period.peak_z_score.toFixed(2)}</td>
                      <td className="px-4 py-2 font-mono" style={{ color: period.avg_correlation_during >= 0 ? "#10b981" : "#3b82f6" }}>
                        {period.avg_correlation_during >= 0 ? "+" : ""}{period.avg_correlation_during.toFixed(3)}
                      </td>
                      <td className="px-4 py-2 font-mono text-commodity-muted/60">{period.normal_correlation >= 0 ? "+" : ""}{period.normal_correlation.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {allAlerts.length === 0 && (
          <div className="text-center py-6 text-commodity-muted/40 text-sm">
            No alert periods detected with z_threshold = 2.0
          </div>
        )}
      </div>
    );
  }

  // ── Causality Network ────────────────────────────────────────────────────────

  function CausalityNetwork({ gr }: { gr: GrangerResult }) {
    const sigEdges = useMemo(() =>
      gr.significant_pairs.slice(0, 10).sort((a, b) => (a as {p_value: number}).p_value - (b as {p_value: number}).p_value),
    [gr]);

    const nodes = gr.network.nodes;
    const svgW = 560, svgH = 380, cx = 280, cy = 190, r = 150;
    const nodePositions = nodes.map((name, i) => ({
      name,
      x: cx + r * Math.cos(2 * Math.PI * i / nodes.length - Math.PI / 2),
      y: cy + r * Math.sin(2 * Math.PI * i / nodes.length - Math.PI / 2),
    }));
    const posMap = Object.fromEntries(nodePositions.map((n) => [n.name, n]));

    const outDegree: Record<string, number> = {};
    for (const e of gr.network.edges) outDegree[e.from] = (outDegree[e.from] ?? 0) + 1;
    const maxDeg = Math.max(1, ...Object.values(outDegree));

    const maxF = Math.max(1, ...gr.results.map((r: {f_statistic?: number}) => r.f_statistic ?? 0));

    const formatPValue = (p: number) => {
      if (p < 0.0001) return p.toExponential(2);
      return p.toFixed(4);
    };

    const hubNode = nodes.reduce((best, n) => (outDegree[n] ?? 0) > (outDegree[best] ?? 0) ? n : best, nodes[0]);
    const indepNode = nodes.reduce((best, n) => (outDegree[n] ?? 0) < (outDegree[best] ?? 0) ? n : best, nodes[0]);

    return (
      <div className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-5 items-end bg-commodity-panel rounded-xl p-4">
          <div>
            <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1.5">Max Lag</p>
            <div className="flex items-center gap-2">
              <input
                type="range" min={5} max={20} step={1} value={grangerMaxLag}
                onChange={(e) => setGrangerMaxLag(Number(e.target.value))}
                className="w-28 accent-amber-500"
              />
              <span className="text-sm font-mono text-amber-400 w-6">{grangerMaxLag}</span>
            </div>
          </div>
          <div>
            <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1.5">Significance Level</p>
            <div className="flex gap-1">
              {[0.01, 0.05, 0.10].map((s) => (
                <button key={s} onClick={() => setGrangerSig(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    grangerSig === s
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-commodity-card text-commodity-muted border border-commodity-border hover:text-commodity-text"
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>
          <button
            onClick={handleRunGranger}
            disabled={grangerLoading || !canRun}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 text-sm font-semibold transition-colors"
          >
            {grangerLoading
              ? <><Loader2 className="w-4 h-4 animate-spin" />Running tests…</>
              : <>Run Granger Causality Test</>}
          </button>
        </div>

        {grangerError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{grangerError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Causality table */}
          <div className="bg-commodity-panel rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-commodity-border/50">
              <h3 className="text-xs font-semibold text-commodity-text">Causality Results</h3>
              <p className="text-[10px] text-commodity-muted/50">Sorted by p-value · Significant at α = {grangerSig}</p>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-commodity-panel">
                  <tr className="border-b border-commodity-border/60">
                    {["Direction", "Best Lag", "F-Stat", "P-Value", "Sig?"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-[9px] text-commodity-muted/40 uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(gr.results as Array<{cause: string; effect: string; best_lag: number; f_statistic: number; p_value: number; significant: boolean}>)
                    .slice().sort((a, b) => a.p_value - b.p_value)
                    .map((row, i) => (
                    <tr key={i} className={`border-b border-commodity-border/20 hover:bg-commodity-card/30 ${row.significant ? "bg-green-500/5" : ""}`}>
                      <td className="px-3 py-2 font-medium text-commodity-text whitespace-nowrap">
                        {row.cause} <span className="text-amber-400">→</span> {row.effect}
                      </td>
                      <td className="px-3 py-2 font-mono text-commodity-muted/70">{row.best_lag}d</td>
                      <td className="px-3 py-2 font-mono text-commodity-text">{row.f_statistic.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-commodity-muted/80">{formatPValue(row.p_value)}</td>
                      <td className="px-3 py-2">
                        {row.significant
                          ? <span className="text-green-400 font-bold">✅</span>
                          : <span className="text-commodity-muted/30">❌</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* SVG network graph */}
          <div className="bg-commodity-panel rounded-xl p-3">
            <h3 className="text-xs font-semibold text-commodity-text mb-1 px-1">Causal Network</h3>
            <p className="text-[10px] text-commodity-muted/50 mb-2 px-1 font-mono">Arrow: cause → effect · thickness ∝ F-stat</p>
            <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ maxHeight: 340 }}>
              <defs>
                <marker id="arrowAmber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
                </marker>
                <marker id="arrowMuted" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#334155" />
                </marker>
              </defs>

              {/* Non-significant edges (faint) */}
              {gr.network.edges.filter((e) => !sigEdges.find((s) => (s as {cause:string;effect:string}).cause === e.from && (s as {cause:string;effect:string}).effect === e.to)).map((edge, i) => {
                const src = posMap[edge.from]; const tgt = posMap[edge.to];
                if (!src || !tgt) return null;
                const dx = tgt.x - src.x; const dy = tgt.y - src.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const nodeR = 20;
                const sx = src.x + (dx / dist) * nodeR; const sy = src.y + (dy / dist) * nodeR;
                const ex = tgt.x - (dx / dist) * (nodeR + 8); const ey = tgt.y - (dy / dist) * (nodeR + 8);
                const mx = (sx + ex) / 2 - dy * 0.2; const my = (sy + ey) / 2 + dx * 0.2;
                return (
                  <path key={`ne-${i}`} d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
                    stroke="#334155" strokeWidth={0.8} fill="none" strokeOpacity={0.4} markerEnd="url(#arrowMuted)" />
                );
              })}

              {/* Significant edges */}
              {sigEdges.map((edge, i) => {
                const e = edge as {cause: string; effect: string; best_lag?: number; f_statistic?: number};
                const src = posMap[e.cause]; const tgt = posMap[e.effect];
                if (!src || !tgt) return null;
                const fStat = e.f_statistic ?? 1;
                const sw = 1 + (fStat / maxF) * 3;
                const dx = tgt.x - src.x; const dy = tgt.y - src.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const nodeR = 20;
                const sx = src.x + (dx / dist) * nodeR; const sy = src.y + (dy / dist) * nodeR;
                const ex = tgt.x - (dx / dist) * (nodeR + 8); const ey = tgt.y - (dy / dist) * (nodeR + 8);
                const mx = (sx + ex) / 2 - dy * 0.25; const my = (sy + ey) / 2 + dx * 0.25;
                const midX = (sx + 2 * mx + ex) / 4; const midY = (sy + 2 * my + ey) / 4;
                return (
                  <g key={`se-${i}`}>
                    <path d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
                      stroke="#f59e0b" strokeWidth={sw} fill="none" strokeOpacity={0.85}
                      markerEnd="url(#arrowAmber)" />
                    <text x={midX} y={midY - 5} textAnchor="middle" fontSize={9} fill="#f59e0b" opacity={0.9}>
                      {e.best_lag}d
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {nodePositions.map((node) => {
                const deg = outDegree[node.name] ?? 0;
                const nodeR = 18 + (deg / maxDeg) * 10;
                const isHub = node.name === hubNode;
                return (
                  <g key={node.name}>
                    <circle cx={node.x} cy={node.y} r={nodeR}
                      fill={isHub ? "#f59e0b" : "#1e293b"}
                      stroke={isHub ? "#fbbf24" : "#334155"} strokeWidth={isHub ? 2 : 1.5} />
                    <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
                      fontSize={10} fontWeight={600}
                      fill={isHub ? "#0f172a" : "#e2e8f0"}
                      style={{ pointerEvents: "none" }}>
                      {node.name.length > 8 ? node.name.slice(0, 7) + "…" : node.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Network insight card */}
        <div className="bg-commodity-panel rounded-xl p-4 border border-commodity-border/60 space-y-3">
          <h3 className="text-xs font-semibold text-commodity-text">Network Insights</h3>
          {sigEdges.length === 0 ? (
            <p className="text-[11px] text-commodity-muted/60">No significant Granger causal relationships found at α = {grangerSig}.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider">Key Causal Relationships</p>
                {sigEdges.slice(0, 5).map((edge, i) => {
                  const e = edge as {cause: string; effect: string; best_lag?: number; f_statistic?: number; p_value?: number};
                  return (
                    <p key={i} className="text-[11px] text-commodity-muted/80">
                      <span className="text-amber-400 font-semibold">{e.cause}</span> price changes predict{" "}
                      <span className="text-amber-400 font-semibold">{e.effect}</span> price changes{" "}
                      {e.best_lag ?? 0} day{(e.best_lag ?? 0) !== 1 ? "s" : ""} later
                      {" "}(F={e.f_statistic?.toFixed(2)}, p={formatPValue(e.p_value ?? 0)})
                    </p>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-commodity-border/50">
                <div>
                  <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1">Hub Asset</p>
                  <p className="text-xs font-semibold text-amber-400">{hubNode}</p>
                  <p className="text-[10px] text-commodity-muted/60 mt-0.5">{outDegree[hubNode] ?? 0} outgoing causal edges — movements tend to predict other commodity prices</p>
                </div>
                <div>
                  <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1">Most Independent</p>
                  <p className="text-xs font-semibold text-slate-400">{indepNode}</p>
                  <p className="text-[10px] text-commodity-muted/60 mt-0.5">{outDegree[indepNode] ?? 0} outgoing edges — moves relatively independently</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Pair summary cards ──────────────────────────────────────────────────────

  function PairChips({ pairs, title, muted }: { pairs: CorrelationPair[]; title: string; muted?: boolean }) {
    return (
      <div>
        <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-1.5">{title}</p>
        <div className="flex flex-wrap gap-2">
          {pairs.slice(0, 5).map((p) => (
            <div
              key={p.pair}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-commodity-card border border-commodity-border"
            >
              <span className="text-[11px] text-commodity-muted/70">{p.pair}</span>
              <span
                className="text-[11px] font-mono font-bold"
                style={{ color: muted ? "#64748b" : corrColor(p.correlation) }}
              >
                {p.correlation >= 0 ? "+" : ""}{p.correlation.toFixed(3)}
              </span>
              <span className="text-[9px] text-amber-400/70">{sigStars(p.p_value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-10">

      {/* ── A: Configuration ─────────────────────────────────────────────────── */}
      <div className="bg-commodity-card border border-commodity-border rounded-xl p-5 space-y-5">

        {/* Row 1 — Dataset status */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-commodity-text mb-2">Loaded Datasets ({datasets.length})</p>
            {!canRun ? (
              <div className="flex items-center gap-2 text-amber-400/80 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Load at least 2 datasets in Data Hub for correlation analysis
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {datasets.map((ds) => (
                  <span key={ds.id} className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-medium">
                    {ds.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Link href="/data" className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors whitespace-nowrap">
            Manage datasets →
          </Link>
        </div>

        {/* Row 2 — Method / Type / Period */}
        <div className="flex flex-wrap gap-6 items-start">

          {/* Method */}
          <div>
            <p className="text-[9px] text-commodity-muted/50 uppercase tracking-wider mb-1.5">Correlation Method</p>
            <div className="flex rounded-lg overflow-hidden border border-commodity-border">
              {(["pearson", "spearman"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    method === m
                      ? "bg-amber-500/20 text-amber-400 border-r border-commodity-border"
                      : "bg-commodity-panel text-commodity-muted hover:text-commodity-text border-r border-commodity-border last:border-r-0"
                  }`}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-commodity-muted/40 mt-1">
              {method === "pearson" ? "Linear relationships" : "Monotonic rank-based"}
            </p>
          </div>

          {/* Data type */}
          <div>
            <p className="text-[9px] text-commodity-muted/50 uppercase tracking-wider mb-1.5">Data Type</p>
            <div className="flex rounded-lg overflow-hidden border border-commodity-border">
              {([true, false] as const).map((r) => (
                <button
                  key={String(r)}
                  onClick={() => setUseReturns(r)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    useReturns === r
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-commodity-panel text-commodity-muted hover:text-commodity-text"
                  } ${r ? "border-r border-commodity-border" : ""}`}
                >
                  {r ? "Returns" : "Prices"}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-commodity-muted/40 mt-1">
              {useReturns ? "Recommended — avoids spurious trend correlation" : "Raw prices (may be spurious)"}
            </p>
          </div>

          {/* Period */}
          <div>
            <p className="text-[9px] text-commodity-muted/50 uppercase tracking-wider mb-1.5">Period</p>
            <div className="flex gap-1">
              {PERIOD_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPeriod(value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    period === value
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-commodity-panel text-commodity-muted border border-commodity-border hover:text-commodity-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3 — Run button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRun}
            disabled={!canRun || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 text-sm font-semibold transition-colors"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Computing correlation matrix…</>
            ) : (
              <><Link2 className="w-4 h-4" />Run Correlation Analysis</>
            )}
          </button>
          {result && !isLoading && (
            <span className="text-[11px] text-commodity-muted/50 font-mono">
              {result.num_observations} obs · {result.period_start} → {result.period_end}
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {!result && !isLoading && !error && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Link2 className="w-14 h-14 text-commodity-muted/20" />
          <p className="text-base text-commodity-muted">
            {canRun
              ? "Configure options above and run correlation analysis"
              : "Load at least 2 datasets to analyze cross-asset correlations"}
          </p>
          {!canRun && (
            <Link href="/data" className="text-sm text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1.5">
              Go to Data Hub →
            </Link>
          )}
        </div>
      )}

      {/* ── B: Heatmap ────────────────────────────────────────────────────────── */}
      {result && (
        <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-commodity-text">Cross-Asset Correlation Matrix</h2>
              <p className="text-[11px] text-commodity-muted/60 mt-0.5 font-mono">
                {result.method.charAt(0).toUpperCase() + result.method.slice(1)} correlation on{" "}
                {result.used_returns ? "returns" : "prices"} — {PERIOD_LABELS[period] ?? period}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-commodity-muted/40 bg-commodity-panel px-2 py-1 rounded-lg border border-commodity-border">
              <span>Click any cell to drill down</span>
            </div>
          </div>

          <HeatmapGrid result={result} selectedCell={selectedCell} onCellClick={handleCellClick} />

          {/* Top / Bottom pairs */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t border-commodity-border/50">
            <PairChips pairs={result.top_correlations}    title="Highest Correlated Pairs" />
            <PairChips pairs={result.bottom_correlations} title="Lowest |Correlation| Pairs" muted />
          </div>
        </div>
      )}

      {/* ── C: Pair Drill-Down ────────────────────────────────────────────────── */}
      {selectedCell && result && (
        <div ref={drilldownRef} className="bg-commodity-card border border-commodity-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-commodity-text mb-1">
            Pair Analysis: <span className="text-amber-400">{selectedPairName}</span>
          </h2>
          <p className="text-[11px] text-commodity-muted/50 mb-4 font-mono">
            Static r = {result.correlation_matrix.values[selectedCell[0]][selectedCell[1]].toFixed(4)} ·
            Rolling windows: 30D / 60D / 90D
          </p>

          {rollingLoading && (
            <div className="flex items-center gap-2 py-8 text-commodity-muted/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading rolling correlation…
            </div>
          )}

          {rollingError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {rollingError}
            </div>
          )}

          {rollingResult && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              {/* Rolling chart */}
              <div className="lg:col-span-3 bg-commodity-panel rounded-xl p-4">
                <h3 className="text-xs font-semibold text-commodity-text mb-3">Rolling Correlation</h3>
                <RollingChart result={rollingResult} />
              </div>

              {/* Stats + Histogram */}
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-commodity-panel rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-commodity-text mb-3">Pair Statistics</h3>
                  <PairStats result={rollingResult} />
                </div>
                <div className="bg-commodity-panel rounded-xl p-4">
                  <Histogram result={rollingResult} />
                </div>

                {/* Regime timeline */}
                {rollingResult.regimes.length > 0 && (
                  <div className="bg-commodity-panel rounded-xl p-4">
                    <p className="text-[9px] text-commodity-muted/40 uppercase tracking-wider mb-2">Recent Regimes</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {rollingResult.regimes.slice(-8).reverse().map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px]">
                          <span className="text-commodity-muted/50 font-mono">{r.start} — {r.end}</span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                                r.regime === "high"   ? "bg-amber-500/15 text-amber-400"  :
                                r.regime === "low"    ? "bg-blue-500/15 text-blue-400"    :
                                "bg-slate-500/15 text-slate-400"
                              }`}
                            >
                              {r.regime}
                            </span>
                            <span className="font-mono text-commodity-muted/60">
                              {r.avg_correlation >= 0 ? "+" : ""}{r.avg_correlation.toFixed(3)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── E: Regime Analysis ────────────────────────────────────────────────── */}
      {selectedCell && result && (
        <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-semibold text-commodity-text">🔬 Regime Analysis</span>
            <span className="text-[10px] text-commodity-muted/50 font-mono">volatility-conditioned correlation</span>
            {regimeLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/60 ml-auto" />}
          </div>
          {enhancedError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-4">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{enhancedError}
            </div>
          )}
          {regimeLoading && !regimeResult && (
            <div className="flex items-center gap-2 py-8 text-commodity-muted/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />Computing regime scatter…
            </div>
          )}
          {regimeResult && selectedCell && result && (() => {
            const cols = result.correlation_matrix.columns;
            return (
              <RegimeScatterSection
                rs={regimeResult}
                nameA={cols[selectedCell[0]]}
                nameB={cols[selectedCell[1]]}
              />
            );
          })()}
        </div>
      )}

      {/* ── F: Lead-Lag Analysis ──────────────────────────────────────────────── */}
      {selectedCell && result && (
        <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-semibold text-commodity-text">⏱️ Lead-Lag Analysis</span>
            <span className="text-[10px] text-commodity-muted/50 font-mono">cross-correlation at different time lags</span>
            {crossLagLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/60 ml-auto" />}
          </div>
          {crossLagLoading && !crossLagResult && (
            <div className="flex items-center gap-2 py-8 text-commodity-muted/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />Computing cross-lag correlations…
            </div>
          )}
          {crossLagResult && selectedCell && result && (() => {
            const cols = result.correlation_matrix.columns;
            return (
              <CrossLagSection
                cl={crossLagResult}
                nameA={cols[selectedCell[0]]}
                nameB={cols[selectedCell[1]]}
              />
            );
          })()}
        </div>
      )}

      {/* ── G: Correlation Alerts ─────────────────────────────────────────────── */}
      {result && (
        <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-semibold text-commodity-text">🚨 Correlation Alerts</span>
            <span className="text-[10px] text-commodity-muted/50 font-mono">z-score anomaly detection · 60-day rolling window</span>
            {alertLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/60 ml-auto" />}
          </div>
          {alertLoading && !alertResult && (
            <div className="flex items-center gap-2 py-8 text-commodity-muted/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />Scanning for correlation anomalies…
            </div>
          )}
          {alertResult && (
            <AlertsSection ar={alertResult} selectedPair={selectedPairName} />
          )}
        </div>
      )}

      {/* ── H: Causality Network ──────────────────────────────────────────────── */}
      {result && (
        <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-semibold text-commodity-text">🔄 Causality Network</span>
            <span className="text-[10px] text-commodity-muted/50 font-mono">Granger causality · directed graph</span>
            {grangerLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/60 ml-auto" />}
          </div>
          {!grangerResult && !grangerLoading && (
            <CausalityNetwork gr={{ results: [], significant_pairs: [], network: { nodes: result.correlation_matrix.columns, edges: [] }, max_lag_tested: grangerMaxLag, significance_level: grangerSig }} />
          )}
          {grangerResult && <CausalityNetwork gr={grangerResult} />}
        </div>
      )}

      {/* ── D: Interpretation ─────────────────────────────────────────────────── */}
      {result && (
        <>
          <InterpretCard result={result} />
          <ExplainButton
            analysisType="correlation"
            resultsSummary={explainSummary}
            datasetNames={result.correlation_matrix.columns}
          />
        </>
      )}
    </div>
  );
}
