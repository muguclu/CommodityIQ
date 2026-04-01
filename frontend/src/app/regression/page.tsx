"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import ExplainButton from "@/components/ui/ExplainButton";
import {
  TrendingUp,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  BarChart2,
  Zap,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Scatter,
  Line,
  Area,
  LineChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ScatterChart,
  Cell,
} from "recharts";
import { useCommodityStore } from "@/lib/store";
import { runRegression, runStepwise, runRollingRegression, runStructuralBreaks } from "@/lib/api";
import type {
  RegressionResult,
  CoefficientDetail,
  CommodityDataset,
  StepwiseResult,
  RollingRegressionResult,
  StructuralBreakResult,
} from "@/lib/types";

// ── Mode type ─────────────────────────────────────────────────────────────────
type Mode = "simple" | "multi" | "auto";

// ── Constants ──────────────────────────────────────────────────────────────────

const CONF_LEVELS = [
  { label: "90%", value: 0.9 },
  { label: "95%", value: 0.95 },
  { label: "99%", value: 0.99 },
];

const MODES: { id: Mode; label: string; Icon: React.ElementType }[] = [
  { id: "simple",  label: "Simple (1 var)",    Icon: TrendingUp },
  { id: "multi",   label: "Multi-variate",      Icon: BarChart2  },
  { id: "auto",    label: "Auto (Stepwise)",    Icon: Zap        },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeOverlapMulti(dep: CommodityDataset, inds: CommodityDataset[]) {
  let common = dep.records.map((r) => r.date);
  for (const ind of inds) {
    const s = new Set(ind.records.map((r) => r.date));
    common = common.filter((d) => s.has(d));
  }
  if (common.length === 0) return null;
  const sorted = common.slice().sort();
  return { start: sorted[0], end: sorted[sorted.length - 1], count: common.length };
}

function makeBins(values: number[], n = 20) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: min.toFixed(3), x: min, count: values.length }];
  const w = (max - min) / n;
  const bins = Array.from({ length: n }, (_, i) => ({
    label: (min + (i + 0.5) * w).toFixed(2),
    x: +(min + (i + 0.5) * w).toFixed(4),
    count: 0,
  }));
  values.forEach((v) => { bins[Math.min(Math.floor((v - min) / w), n - 1)].count++; });
  return bins;
}

function r2Color(v: number) {
  if (v > 0.7) return "text-emerald-400";
  if (v > 0.4) return "text-amber-400";
  return "text-red-400";
}
function dwInfo(dw: number): { label: string; color: string } {
  if (dw < 1.5) return { label: "Positive autocorrelation", color: "text-red-400" };
  if (dw > 2.5) return { label: "Negative autocorrelation", color: "text-amber-400" };
  return { label: "No autocorrelation", color: "text-emerald-400" };
}
function formatPValue(p: number): string {
  if (p === 0) return "< 1e-16";
  if (p < 0.0001) return p.toExponential(2);
  return p.toFixed(4);
}
function pValueColor(p: number) {
  if (p < 0.05) return "text-emerald-400";
  return "text-red-400";
}
function pValueStars(p: number) {
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "";
}
function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function fmtAxisDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function vifStyle(vif: number) {
  if (vif >= 10) return { bar: "bg-red-500",    text: "text-red-400",    label: "Severe"   };
  if (vif >= 5)  return { bar: "bg-amber-400",  text: "text-amber-400",  label: "Moderate" };
  return               { bar: "bg-emerald-400", text: "text-emerald-400", label: "OK"      };
}
function correlColor(v: number) {
  const a = (Math.abs(v) * 0.75).toFixed(2);
  if (v > 0) return `rgba(59,130,246,${a})`;
  if (v < 0) return `rgba(239,68,68,${a})`;
  return "transparent";
}
function interpret(r: RegressionResult): string[] {
  const coef = r.coefficients.find((c) => c.name !== "Intercept");
  const strength = r.r_squared > 0.7 ? "strong" : r.r_squared > 0.4 ? "moderate" : "weak";
  const sig = r.f_pvalue < 0.05;
  const varList = r.independent_names.join(", ");
  const lines = [
    `The model shows a ${strength} fit (R² = ${r.r_squared.toFixed(4)}), explaining ${(r.r_squared * 100).toFixed(1)}% of variance in ${r.dependent_name}.`,
    r.independent_names.length === 1 && coef
      ? Math.abs(coef.value) < 0.1
        ? `The coefficient of ${coef.value.toFixed(4)} on ${r.independent_names[0]} means a 1-unit increase changes ${r.dependent_name} by ${coef.value > 0 ? "+" : ""}${coef.value.toFixed(4)} (≈ $${(coef.value * 100).toFixed(2)} per $100).`
        : `The coefficient of ${coef.value.toFixed(4)} on ${r.independent_names[0]} means a 1-unit increase changes ${r.dependent_name} by ${coef.value > 0 ? "+" : ""}${coef.value.toFixed(4)}.`
      : `The model includes ${r.independent_names.length} predictors: ${varList}.`,
    `The model is ${sig ? "statistically significant" : "not statistically significant"} (F-test p = ${formatPValue(r.f_pvalue)}).`,
    r.vif_scores.some((v) => v.vif >= 10)
      ? `⚠️ Severe multicollinearity in: ${r.vif_scores.filter((v) => v.vif >= 10).map((v) => v.name).join(", ")}. Consider removing one.`
      : "",
  ];
  return lines.filter(Boolean);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatBadge({ label, value, sub, color = "text-commodity-text", wide = false }:
  { label: string; value: string; sub?: string; color?: string; wide?: boolean }) {
  return (
    <div className={`bg-commodity-panel border border-commodity-border rounded-lg p-3 ${wide ? "col-span-2" : ""}`}>
      <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-mono font-bold text-base leading-tight ${color}`}>{value}</p>
      {sub && <p className="font-mono text-[10px] text-commodity-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function CoefTable({ coefficients, confLevel }: { coefficients: CoefficientDetail[]; confLevel: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-commodity-muted uppercase tracking-wider border-b border-commodity-border">
            <th className="pb-2 text-left font-medium">Variable</th>
            <th className="pb-2 text-right font-mono font-medium">Coef.</th>
            <th className="pb-2 text-right font-mono font-medium">Std Err</th>
            <th className="pb-2 text-right font-mono font-medium">t-Stat</th>
            <th className="pb-2 text-right font-mono font-medium">P-Val</th>
            <th className="pb-2 text-right font-mono font-medium">{(confLevel * 100).toFixed(0)}% CI</th>
          </tr>
        </thead>
        <tbody>
          {coefficients.map((c, i) => (
            <tr key={i} className="border-b border-commodity-border/40 hover:bg-commodity-panel/60 transition-colors">
              <td className="py-2.5 pr-3 text-commodity-text font-medium">{c.name}</td>
              <td className="py-2.5 text-right font-mono text-commodity-text">{c.value.toFixed(4)}</td>
              <td className="py-2.5 text-right font-mono text-commodity-muted">{c.std_error.toFixed(4)}</td>
              <td className="py-2.5 text-right font-mono text-commodity-muted">{c.t_statistic.toFixed(4)}</td>
              <td className={`py-2.5 text-right font-mono font-semibold ${pValueColor(c.p_value)}`}>
                {formatPValue(c.p_value)}{pValueStars(c.p_value) && <sup className="ml-0.5 text-[9px]">{pValueStars(c.p_value)}</sup>}
              </td>
              <td className="py-2.5 text-right font-mono text-commodity-muted whitespace-nowrap">
                [{c.ci_lower.toFixed(3)}, {c.ci_upper.toFixed(3)}]
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ScatterPayloadItem { name: string; value: number; payload: { x: number; y: number; date?: string } }
function ScatterTip({ active, payload, depName, xName }:
  { active?: boolean; payload?: ScatterPayloadItem[]; depName: string; xName: string }) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  return (
    <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl min-w-[150px]">
      {pt?.date && <p className="text-slate-400 font-mono mb-1.5 pb-1 border-b border-slate-700/60">{pt.date}</p>}
      <div className="space-y-0.5">
        <div className="flex justify-between gap-3"><span className="text-slate-400">{xName}:</span><span className="text-slate-100 font-mono">{pt?.x?.toFixed(4)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-slate-400">{depName}:</span><span className="text-slate-100 font-mono">{pt?.y?.toFixed(4)}</span></div>
      </div>
    </div>
  );
}

function VifPanel({ scores }: { scores: { name: string; vif: number }[] }) {
  const hasSevere = scores.some((v) => v.vif >= 10);
  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-1">VIF — Multicollinearity</h3>
      <p className="text-[11px] text-commodity-muted mb-4">&gt;5 = moderate · &gt;10 = severe</p>
      {hasSevere && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Severe: <strong>{scores.filter((v) => v.vif >= 10).map((v) => v.name).join(", ")}</strong>. Consider removing one.</span>
        </div>
      )}
      <div className="space-y-3">
        {scores.map((v) => {
          const c = vifStyle(v.vif);
          return (
            <div key={v.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-commodity-text font-medium">{v.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${c.text}`}>{c.label}</span>
                  <span className={`font-mono text-xs font-bold ${c.text}`}>{v.vif.toFixed(2)}</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-commodity-panel rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.min(v.vif / 20, 1) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CorrelHeatmap({ matrix }: { matrix: { columns: string[]; values: number[][] } }) {
  const { columns, values } = matrix;
  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-1">Correlation Matrix</h3>
      <p className="text-[11px] text-commodity-muted mb-4">Pearson correlations — blue: positive, red: negative</p>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-px" style={{ gridTemplateColumns: `80px repeat(${columns.length}, 64px)` }}>
          <div className="h-8" />
          {columns.map((col) => (
            <div key={col} className="h-8 flex items-center justify-center px-1">
              <span className="text-[10px] text-commodity-muted font-medium truncate max-w-[60px] text-center">{col}</span>
            </div>
          ))}
          {columns.map((rowName, ri) => (
            <React.Fragment key={rowName}>
              <div className="h-14 flex items-center justify-end pr-2">
                <span className="text-[10px] text-commodity-muted font-medium truncate max-w-[76px] text-right">{rowName}</span>
              </div>
              {columns.map((_, ci) => {
                const v = values[ri][ci];
                const diag = ri === ci;
                return (
                  <div key={ci} className="h-14 flex items-center justify-center rounded"
                    style={{ backgroundColor: diag ? "rgba(100,116,139,0.15)" : correlColor(v) }}>
                    <span className={`font-mono text-[11px] font-semibold ${diag ? "text-commodity-muted" : Math.abs(v) > 0.5 ? "text-white" : "text-commodity-text"}`}>
                      {v.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function PartialPlots({ plots, depName }: { plots: { name: string; data: { x_partial: number; y_partial: number }[] }[]; depName: string }) {
  if (!plots.length) return null;
  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-1">Partial Regression Plots</h3>
      <p className="text-[11px] text-commodity-muted mb-4">Added-variable plots — isolates each predictor controlling for others</p>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {plots.map((plot) => {
          const xs = plot.data.map((p) => p.x_partial), ys = plot.data.map((p) => p.y_partial), n = xs.length;
          const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
          const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
          const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
          const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
          const corr = dx * dy === 0 ? 0 : num / (dx * dy);
          return (
            <div key={plot.name} className="bg-commodity-panel rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-commodity-text truncate">{plot.name}</span>
                <span className={`font-mono text-[10px] ${Math.abs(corr) > 0.5 ? "text-amber-400" : "text-commodity-muted"}`}>r = {corr.toFixed(2)}</span>
              </div>
              <ResponsiveContainer width="100%" height={150}>
                <ScatterChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#334155" />
                  <XAxis type="number" dataKey="x" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(1)} />
                  <YAxis type="number" dataKey="y" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(1)} width={36} />
                  <Scatter data={plot.data.map((p) => ({ x: p.x_partial, y: p.y_partial }))} fill="#f59e0b" fillOpacity={0.6} isAnimationActive={false} />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.1)" />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-[9px] text-commodity-muted text-center mt-1">e({plot.name}|others) vs e({depName}|others)</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepwiseTimeline({ result }: { result: StepwiseResult }) {
  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-1">Stepwise Selection</h3>
      <p className="text-[11px] text-commodity-muted mb-4">
        Forward selection — {result.steps.length} variable{result.steps.length !== 1 ? "s" : ""} selected
      </p>
      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-0 min-w-max">
          {result.steps.map((step, i) => (
            <React.Fragment key={step.step}>
              <div className={`w-44 border rounded-lg p-3 flex-shrink-0 ${i === result.steps.length - 1 ? "border-amber-500/40 bg-amber-500/5" : "border-commodity-border bg-commodity-panel"}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === result.steps.length - 1 ? "bg-amber-500 text-slate-900" : "bg-slate-600 text-slate-200"}`}>{step.step}</span>
                  <span className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">Added</span>
                </div>
                <p className="text-xs font-semibold text-commodity-text mb-2 truncate">{step.variable}</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-commodity-muted">R²</span>
                    <span className={`font-mono font-medium ${r2Color(step.r_squared)}`}>{step.r_squared.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-commodity-muted">AIC</span>
                    <span className="font-mono text-commodity-muted">{step.aic.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-commodity-muted">p-val</span>
                    <span className={`font-mono ${pValueColor(step.p_value)}`}>{formatPValue(step.p_value)}</span>
                  </div>
                </div>
              </div>
              {i < result.steps.length - 1 && (
                <div className="flex items-center self-center px-1">
                  <div className="w-4 h-px bg-commodity-border" />
                  <ChevronDown className="w-3 h-3 text-commodity-muted -rotate-90" />
                  <div className="w-4 h-px bg-commodity-border" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      {result.excluded_variables.length > 0 && (
        <div className="mt-4 pt-4 border-t border-commodity-border">
          <p className="text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Excluded</p>
          <div className="flex flex-wrap gap-2">
            {result.excluded_variables.map((v) => (
              <div key={v} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-commodity-panel border border-commodity-border text-xs">
                <X className="w-3 h-3 text-red-400" />
                <span className="text-commodity-muted">{v}</span>
                <span className="text-commodity-muted/50">·</span>
                <span className="text-[10px] text-commodity-muted/70">{result.excluded_reasons[v]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Advanced Diagnostics constants ───────────────────────────────────────────

const WINDOW_COLORS: Record<number, string> = { 30: "#f59e0b", 60: "#3b82f6", 90: "#8b5cf6" };
const WINDOW_WIDTHS: Record<number, number> = { 30: 1, 60: 1.5, 90: 2 };

type SeriesInfo = { name: string; values: number[]; dates: string[] };

// ── AdvancedDiagnostics component ─────────────────────────────────────────────

function AdvancedDiagnostics({ depSeries, indSeries }: { depSeries: SeriesInfo; indSeries: SeriesInfo }) {
  const [open, setOpen] = useState(false);
  const [rollingResult, setRollingResult] = useState<RollingRegressionResult | null>(null);
  const [breaksResult, setBreaksResult] = useState<StructuralBreakResult | null>(null);
  const [isRollingLoading, setIsRollingLoading] = useState(false);
  const [isBreaksLoading, setIsBreaksLoading] = useState(false);
  const [rollingError, setRollingError] = useState<string | null>(null);
  const [breaksError, setBreaksError] = useState<string | null>(null);

  const handleRolling = useCallback(async () => {
    setIsRollingLoading(true); setRollingError(null);
    try { setRollingResult(await runRollingRegression({ dependent: depSeries, independent: indSeries })); }
    catch (e: unknown) { setRollingError(e instanceof Error ? e.message : "Rolling analysis failed."); }
    finally { setIsRollingLoading(false); }
  }, [depSeries, indSeries]);

  const handleBreaks = useCallback(async () => {
    setIsBreaksLoading(true); setBreaksError(null);
    try { setBreaksResult(await runStructuralBreaks({ dependent: depSeries, independent: indSeries })); }
    catch (e: unknown) { setBreaksError(e instanceof Error ? e.message : "Break detection failed."); }
    finally { setIsBreaksLoading(false); }
  }, [depSeries, indSeries]);

  const rollingCharts = useMemo(() => {
    if (!rollingResult) return { r2: [], beta: [], pval: [] };
    const dateSet = new Set<string>();
    rollingResult.windows.forEach((w) => w.data.forEach((pt) => dateSet.add(pt.date)));
    const dates = Array.from(dateSet).sort();
    const maps: Record<number, Record<string, { r_squared: number; beta: number; p_value: number }>> = {};
    rollingResult.windows.forEach((w) => {
      maps[w.window_size] = {};
      w.data.forEach((pt) => { maps[w.window_size][pt.date] = pt; });
    });
    const build = (key: "r_squared" | "beta" | "p_value") =>
      dates.map((d) => {
        const row: Record<string, string | number | null> = { date: d };
        rollingResult.windows.forEach((w) => { row[`w${w.window_size}`] = maps[w.window_size][d]?.[key] ?? null; });
        return row;
      });
    return { r2: build("r_squared"), beta: build("beta"), pval: build("p_value") };
  }, [rollingResult]);

  const RollingTip = ({ raw, fmt }: { raw: unknown; fmt?: (v: number) => string }) => {
    const p = raw as unknown as { active?: boolean; payload?: { dataKey: string; value: number; color: string; name: string }[]; label?: string };
    if (!p.active || !p.payload?.length) return null;
    return (
      <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl min-w-[130px]">
        <p className="text-slate-400 font-mono mb-1.5 pb-1 border-b border-slate-700/60">{p.label}</p>
        {p.payload.map((item) => (
          <div key={item.dataKey} className="flex justify-between gap-3">
            <span style={{ color: item.color }}>{item.name}:</span>
            <span className="font-mono text-slate-100">{fmt ? fmt(item.value) : item.value?.toFixed(4)}</span>
          </div>
        ))}
      </div>
    );
  };

  const WindowLegend = () => (
    <div className="flex items-center gap-4 mt-2 justify-center">
      {rollingResult?.windows.map((w) => (
        <div key={w.window_size} className="flex items-center gap-1.5">
          <div style={{ backgroundColor: WINDOW_COLORS[w.window_size] ?? "#94a3b8", width: 16, height: WINDOW_WIDTHS[w.window_size] ?? 1 }} className="rounded" />
          <span className="text-[10px] text-commodity-muted">{w.window_size}d</span>
        </div>
      ))}
    </div>
  );

  const hasCusumBreaks = (breaksResult?.cusum?.breaks_detected.length ?? 0) > 0;
  const hasChowBreak = !!breaksResult?.chow?.most_significant;

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-commodity-panel/40 transition-colors">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-commodity-text">Advanced Diagnostics</span>
          <span className="text-[11px] text-commodity-muted hidden sm:inline ml-1">— Rolling regression · Structural breaks · Regime detection</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-commodity-muted" /> : <ChevronDown className="w-4 h-4 text-commodity-muted" />}
      </button>

      {open && (
        <div className="border-t border-commodity-border p-6 space-y-10 animate-fade-in">

          {/* ── Sub-section 1: Rolling Regression ─────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-commodity-text">Rolling Regression</h3>
                <p className="text-[11px] text-commodity-muted mt-0.5">
                  How R², β, and significance change across 30 / 60 / 90-day windows
                </p>
              </div>
              <button onClick={handleRolling} disabled={isRollingLoading}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                {isRollingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                {isRollingLoading ? "Computing…" : "Run Rolling Analysis"}
              </button>
            </div>
            {rollingError && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{rollingError}</span>
              </div>
            )}
            {!rollingResult && !isRollingLoading && !rollingError && (
              <p className="text-commodity-muted text-sm text-center py-8 border border-dashed border-commodity-border/50 rounded-lg">
                Click "Run Rolling Analysis" to compute window-based regressions
              </p>
            )}
            {rollingResult && (
              <div className="space-y-5">
                {/* Panel A: R² */}
                <div className="bg-commodity-panel rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-commodity-text mb-0.5">Rolling R²</h4>
                  <p className="text-[10px] text-commodity-muted mb-3">Explanatory power — above 0.7 strong, below 0.3 weak</p>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={rollingCharts.r2} margin={{ top: 4, right: 40, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={70} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={32} tickFormatter={(v: number) => v.toFixed(1)} />
                      <ReferenceLine y={0.7} stroke="#10b981" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: "Strong", position: "right", fill: "#10b981", fontSize: 8 }} />
                      <ReferenceLine y={0.3} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: "Weak", position: "right", fill: "#f59e0b", fontSize: 8 }} />
                      {rollingResult.windows.map((w) => (
                        <Line key={w.window_size} type="monotone" dataKey={`w${w.window_size}`}
                          stroke={WINDOW_COLORS[w.window_size] ?? "#94a3b8"} strokeWidth={WINDOW_WIDTHS[w.window_size] ?? 1}
                          dot={false} isAnimationActive connectNulls name={`${w.window_size}d`} />
                      ))}
                      <Tooltip content={(raw) => <RollingTip raw={raw} />} />
                    </LineChart>
                  </ResponsiveContainer>
                  <WindowLegend />
                </div>

                {/* Panel B: Beta */}
                <div className="bg-commodity-panel rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-commodity-text mb-0.5">Rolling β (Beta)</h4>
                  <p className="text-[10px] text-commodity-muted mb-3">
                    Coefficient over time — how much {indSeries.name} moves {depSeries.name}
                  </p>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={rollingCharts.beta} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={70} />
                      <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => v.toFixed(2)} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 3" />
                      {rollingResult.windows.map((w) => (
                        <Line key={w.window_size} type="monotone" dataKey={`w${w.window_size}`}
                          stroke={WINDOW_COLORS[w.window_size] ?? "#94a3b8"} strokeWidth={WINDOW_WIDTHS[w.window_size] ?? 1}
                          dot={false} isAnimationActive connectNulls name={`${w.window_size}d`} />
                      ))}
                      <Tooltip content={(raw) => <RollingTip raw={raw} fmt={(v) => v.toFixed(4)} />} />
                    </LineChart>
                  </ResponsiveContainer>
                  <WindowLegend />
                </div>

                {/* Panel C: P-value */}
                <div className="bg-commodity-panel rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-commodity-text mb-0.5">Rolling P-value</h4>
                  <p className="text-[10px] text-commodity-muted mb-3">Statistical significance — above red line = relationship insignificant</p>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={rollingCharts.pval} margin={{ top: 4, right: 40, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={70} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={32} tickFormatter={(v: number) => v.toFixed(2)} />
                      <ReferenceLine y={0.05} stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: "α=0.05", position: "right", fill: "#ef4444", fontSize: 8 }} />
                      {rollingResult.windows.map((w) => (
                        <Line key={w.window_size} type="monotone" dataKey={`w${w.window_size}`}
                          stroke={WINDOW_COLORS[w.window_size] ?? "#94a3b8"} strokeWidth={WINDOW_WIDTHS[w.window_size] ?? 1}
                          dot={false} isAnimationActive connectNulls name={`${w.window_size}d`} />
                      ))}
                      <Tooltip content={(raw) => {
                        const p = raw as unknown as { active?: boolean; payload?: { dataKey: string; value: number; color: string; name: string }[]; label?: string };
                        if (!p.active || !p.payload?.length) return null;
                        return (
                          <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl min-w-[130px]">
                            <p className="text-slate-400 font-mono mb-1.5 pb-1 border-b border-slate-700/60">{p.label}</p>
                            {p.payload.map((item) => (
                              <div key={item.dataKey} className="flex justify-between gap-3">
                                <span style={{ color: item.color }}>{item.name}:</span>
                                <span className={`font-mono font-semibold ${item.value > 0.05 ? "text-red-400" : "text-emerald-400"}`}>{item.value?.toFixed(4)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <WindowLegend />
                </div>
              </div>
            )}
          </div>

          {/* ── Sub-section 2: Structural Break Detection ───────────────────── */}
          <div className="border-t border-commodity-border/50 pt-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-commodity-text">Structural Break Detection</h3>
                <p className="text-[11px] text-commodity-muted mt-0.5">CUSUM and Chow tests — identify regime changes in the relationship</p>
              </div>
              <button onClick={handleBreaks} disabled={isBreaksLoading}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                {isBreaksLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                {isBreaksLoading ? "Detecting…" : "Detect Structural Breaks"}
              </button>
            </div>
            {breaksError && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{breaksError}</span>
              </div>
            )}
            {!breaksResult && !isBreaksLoading && !breaksError && (
              <p className="text-commodity-muted text-sm text-center py-8 border border-dashed border-commodity-border/50 rounded-lg">
                Click "Detect Structural Breaks" to run CUSUM and Chow tests
              </p>
            )}
            {breaksResult && (
              <div className="space-y-5">
                {/* CUSUM Chart */}
                {breaksResult.cusum && !breaksResult.cusum.error && (
                  <div className="bg-commodity-panel rounded-xl p-4">
                    <div className="flex items-start justify-between mb-0.5">
                      <h4 className="text-xs font-semibold text-commodity-text">CUSUM Test</h4>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${hasCusumBreaks ? "bg-red-500/15 text-red-400 border-red-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"}`}>
                        {hasCusumBreaks ? `${breaksResult.cusum.breaks_detected.length} break${breaksResult.cusum.breaks_detected.length > 1 ? "s" : ""} detected` : "Stable"}
                      </span>
                    </div>
                    <p className="text-[10px] text-commodity-muted mb-3">Cumulative recursive residuals — escaping the corridor signals parameter instability</p>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={breaksResult.cusum.values} margin={{ top: 4, right: 48, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={70} />
                        <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v.toFixed(2)} />
                        <ReferenceLine y={breaksResult.cusum.upper_bound} stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.5}
                          label={{ value: `+${breaksResult.cusum.upper_bound}`, position: "right", fill: "#ef4444", fontSize: 8 }} />
                        <ReferenceLine y={breaksResult.cusum.lower_bound} stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.5}
                          label={{ value: `${breaksResult.cusum.lower_bound}`, position: "right", fill: "#ef4444", fontSize: 8 }} />
                        {breaksResult.cusum.breaks_detected.map((b) => (
                          <ReferenceLine key={b.date} x={b.date} stroke="#ef4444" strokeDasharray="3 2" strokeOpacity={0.5} />
                        ))}
                        <Line type="monotone" dataKey="cusum" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive />
                        <Tooltip content={(raw) => {
                          const p = raw as unknown as { active?: boolean; payload?: { value: number }[]; label?: string };
                          if (!p.active || !p.payload?.length) return null;
                          const v = p.payload[0]?.value ?? 0;
                          const ub = breaksResult.cusum?.upper_bound ?? 0.948;
                          return (
                            <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl">
                              <p className="text-slate-400 font-mono mb-1">{p.label}</p>
                              <p className={`font-mono font-semibold ${Math.abs(v) > ub ? "text-red-400" : "text-violet-400"}`}>CUSUM: {v.toFixed(4)}</p>
                            </div>
                          );
                        }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Chow Test Bar Chart */}
                {breaksResult.chow && breaksResult.chow.tests.length > 0 && (
                  <div className="bg-commodity-panel rounded-xl p-4">
                    <div className="flex items-start justify-between mb-0.5">
                      <h4 className="text-xs font-semibold text-commodity-text">Chow Test — F-statistics</h4>
                      {breaksResult.chow.most_significant && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                          Most significant: {fmtDate(breaksResult.chow.most_significant.date)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-commodity-muted mb-3">Red bars = p &lt; 0.05 (significant break) · Green bars = stable at that date</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={breaksResult.chow.tests} margin={{ top: 4, right: 16, bottom: 28, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                          tickFormatter={fmtAxisDate} angle={-30} textAnchor="end" />
                        <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40}
                          tickFormatter={(v: number) => v.toFixed(1)} />
                        <Bar dataKey="f_statistic" radius={[3, 3, 0, 0]} isAnimationActive>
                          {breaksResult.chow.tests.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.p_value < 0.05 ? "#ef4444" : "#10b981"} fillOpacity={0.75} />
                          ))}
                        </Bar>
                        <Tooltip content={(raw) => {
                          const p = raw as unknown as { active?: boolean; payload?: { payload: { date: string; f_statistic: number; p_value: number } }[]; label?: string };
                          if (!p.active || !p.payload?.length) return null;
                          const d = p.payload[0]?.payload;
                          return (
                            <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl">
                              <p className="text-slate-400 font-mono mb-1">{d?.date}</p>
                              <div className="space-y-0.5">
                                <div className="flex justify-between gap-3"><span className="text-slate-400">F-stat:</span><span className="font-mono text-slate-100">{d?.f_statistic?.toFixed(4)}</span></div>
                                <div className="flex justify-between gap-3"><span className="text-slate-400">p-value:</span>
                                  <span className={`font-mono font-semibold ${(d?.p_value ?? 1) < 0.05 ? "text-red-400" : "text-emerald-400"}`}>{d?.p_value?.toFixed(4)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }} />
                      </BarChart>
                    </ResponsiveContainer>
                    {breaksResult.chow.breaks_detected.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {breaksResult.chow.breaks_detected.map((b) => (
                          <span key={b.date} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-red-500/15 text-red-300 border border-red-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                            {fmtDate(b.date)} · F={b.f_statistic.toFixed(2)} · p={b.p_value.toFixed(3)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-section 3: Break Timeline */}
                {(hasCusumBreaks || hasChowBreak) ? (
                  <div className="bg-commodity-panel rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-commodity-text mb-0.5">Break Timeline</h4>
                    <p className="text-[10px] text-commodity-muted mb-3">
                      {depSeries.name} price with all detected structural break dates
                    </p>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart
                        data={depSeries.dates.map((d, i) => ({ date: d, price: depSeries.values[i] }))}
                        margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={70} />
                        <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={60}
                          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1)} />
                        <Line type="monotone" dataKey="price" stroke="#64748b" strokeWidth={1} dot={false} isAnimationActive={false} />
                        {breaksResult.cusum?.breaks_detected.map((b) => (
                          <ReferenceLine key={`cusum-tl-${b.date}`} x={b.date} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1.5}
                            label={{ value: "CUSUM", position: "insideTopRight", fill: "#ef4444", fontSize: 8 }} />
                        ))}
                        {breaksResult.chow?.most_significant && (
                          <ReferenceLine x={breaksResult.chow.most_significant.date} stroke="#f97316" strokeDasharray="4 3" strokeWidth={2}
                            label={{ value: `Chow · ${fmtDate(breaksResult.chow.most_significant.date)}`, position: "insideTopLeft", fill: "#f97316", fontSize: 8 }} />
                        )}
                        <Tooltip content={(raw) => {
                          const p = raw as unknown as { active?: boolean; payload?: { value: number }[]; label?: string };
                          if (!p.active || !p.payload?.length) return null;
                          return (
                            <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl">
                              <p className="text-slate-400 font-mono mb-1">{p.label}</p>
                              <p className="font-mono text-slate-100">{depSeries.name}: {p.payload[0]?.value?.toFixed(4)}</p>
                            </div>
                          );
                        }} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex items-center gap-4 mt-2">
                      {hasCusumBreaks && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 border-t-2 border-dashed border-red-500" />
                          <span className="text-[10px] text-red-400">CUSUM break</span>
                        </div>
                      )}
                      {hasChowBreak && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 border-t-2 border-dashed border-orange-500" />
                          <span className="text-[10px] text-orange-400">Chow break</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-commodity-panel rounded-xl p-4 text-center">
                    <p className="text-commodity-muted text-xs py-2">
                      No structural breaks detected at the 5% significance level — the relationship appears stable over the sample period.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function RegressionPage() {
  const [mounted, setMounted] = useState(false);
  const { datasets } = useCommodityStore();

  const [mode, setMode] = useState<Mode>("simple");
  const [selectedY, setSelectedY] = useState("");
  const [selectedXId, setSelectedXId] = useState("");
  const [selectedXIds, setSelectedXIds] = useState<string[]>([]);
  const [confLevel, setConfLevel] = useState(0.95);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegressionResult | null>(null);
  const [stepwiseResult, setStepwiseResult] = useState<StepwiseResult | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const effectiveResult = useMemo(() => result ?? stepwiseResult?.final_model ?? null, [result, stepwiseResult]);
  const isSimple = mode === "simple";

  const dsY = useMemo(() => datasets.find((d) => d.id === selectedY), [datasets, selectedY]);
  const availableForX = useMemo(() => datasets.filter((d) => d.id !== selectedY), [datasets, selectedY]);

  const dsXs = useMemo((): CommodityDataset[] => {
    const ids = isSimple ? (selectedXId ? [selectedXId] : []) : selectedXIds;
    return ids.map((id) => datasets.find((d) => d.id === id)).filter((d): d is CommodityDataset => !!d);
  }, [datasets, isSimple, selectedXId, selectedXIds]);

  const overlap = useMemo(() => dsY && dsXs.length > 0 ? computeOverlapMulti(dsY, dsXs) : null, [dsY, dsXs]);

  const clearResults = useCallback(() => { setResult(null); setStepwiseResult(null); setError(null); }, []);

  const handleModeChange = (m: Mode) => { setMode(m); clearResults(); };
  const handleYChange = (id: string) => { setSelectedY(id); setSelectedXId(""); setSelectedXIds([]); clearResults(); };
  const toggleXId = (id: string) => { setSelectedXIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); clearResults(); };

  const canRun = !!selectedY && dsXs.length > 0 && !isLoading;

  const handleRun = useCallback(async () => {
    if (!dsY || dsXs.length === 0) return;
    setIsLoading(true); setError(null); setResult(null); setStepwiseResult(null);
    const dep = { name: dsY.name, dates: dsY.records.map((r) => r.date), values: dsY.records.map((r) => r.close) };
    const inds = dsXs.map((ds) => ({ name: ds.name, dates: ds.records.map((r) => r.date), values: ds.records.map((r) => r.close) }));
    try {
      if (mode === "auto") {
        setStepwiseResult(await runStepwise({ dependent: dep, candidates: inds }));
      } else {
        setResult(await runRegression({ dependent: dep, independents: inds, confidence_level: confLevel }));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [dsY, dsXs, mode, confLevel]);

  const bandData = useMemo(() =>
    effectiveResult?.confidence_band.map((pt) => ({ x: pt.x, y_upper: pt.y_upper, y_lower: pt.y_lower, regLine: (pt.y_lower + pt.y_upper) / 2 })) ?? [],
    [effectiveResult]);

  const residualBins = useMemo(() => effectiveResult ? makeBins(effectiveResult.residuals.map((r) => r.residual)) : [], [effectiveResult]);
  const isMultiVar = (effectiveResult?.independent_names.length ?? 0) > 1;

  const depSeries = useMemo(() =>
    dsY ? { name: dsY.name, dates: dsY.records.map((r) => r.date), values: dsY.records.map((r) => r.close) } : null,
    [dsY]);
  const indSeries = useMemo(() =>
    dsXs[0] ? { name: dsXs[0].name, dates: dsXs[0].records.map((r) => r.date), values: dsXs[0].records.map((r) => r.close) } : null,
    [dsXs]);

  if (!mounted) return null;

  return (
    <div className="p-6 md:p-8 animate-fade-in space-y-6 max-w-screen-2xl">

      {/* ── A: Variable Selector ─────────────────────────────────────────────── */}
      <div className="bg-commodity-card border border-commodity-border rounded-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
          <h2 className="text-sm font-semibold text-commodity-text">Variable Selection</h2>
          <div className="flex gap-1 bg-commodity-panel rounded-lg p-1 border border-commodity-border">
            {MODES.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => handleModeChange(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === id ? "bg-amber-500 text-slate-900" : "text-commodity-muted hover:text-commodity-text"}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
        </div>

        {datasets.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-commodity-muted text-sm mb-2">No datasets loaded yet.</p>
            <Link href="/data" className="text-amber-400 underline underline-offset-2 text-sm">Go to Data Hub →</Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Y */}
              <div>
                <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Dependent Variable (Y)</label>
                <div className="relative">
                  <select value={selectedY} onChange={(e) => handleYChange(e.target.value)}
                    className="w-full bg-[#0f172a] border border-commodity-border text-slate-100 text-sm rounded-lg px-3 py-2.5 appearance-none cursor-pointer hover:border-slate-500 transition-colors focus:outline-none focus:border-amber-500/50">
                    <option value="" className="bg-[#0f172a] text-slate-400">Select dataset…</option>
                    {datasets.map((ds) => (
                      <option key={ds.id} value={ds.id} className="bg-[#0f172a] text-slate-100">{ds.name} · {ds.source.toUpperCase()} · {ds.metadata.rowCount.toLocaleString()} rows</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-commodity-muted pointer-events-none" />
                </div>
              </div>

              {/* X */}
              <div>
                <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">
                  {isSimple ? "Independent Variable (X)" : `Independent Variables (X) · ${selectedXIds.length} of ${availableForX.length} selected`}
                </label>
                {isSimple ? (
                  <div className="relative">
                    <select value={selectedXId} onChange={(e) => { setSelectedXId(e.target.value); clearResults(); }}
                      className="w-full bg-[#0f172a] border border-commodity-border text-slate-100 text-sm rounded-lg px-3 py-2.5 appearance-none cursor-pointer hover:border-slate-500 transition-colors focus:outline-none focus:border-amber-500/50">
                      <option value="" className="bg-[#0f172a] text-slate-400">Select dataset…</option>
                      {availableForX.map((ds) => (
                        <option key={ds.id} value={ds.id} className="bg-[#0f172a] text-slate-100">{ds.name} · {ds.source.toUpperCase()} · {ds.metadata.rowCount.toLocaleString()} rows</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-commodity-muted pointer-events-none" />
                  </div>
                ) : (
                  <div>
                    <div className="flex gap-2 mb-2">
                      <button onClick={() => { setSelectedXIds(availableForX.map((d) => d.id)); clearResults(); }} className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors">Select All</button>
                      <span className="text-commodity-muted/40">·</span>
                      <button onClick={() => { setSelectedXIds([]); clearResults(); }} className="text-[11px] text-commodity-muted hover:text-commodity-text transition-colors">Clear</button>
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-commodity-border bg-commodity-panel divide-y divide-commodity-border/50">
                      {availableForX.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-commodity-muted">No other datasets available</p>
                      ) : availableForX.map((ds) => {
                        const checked = selectedXIds.includes(ds.id);
                        return (
                          <label key={ds.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-commodity-card transition-colors">
                            <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${checked ? "bg-amber-500 border-amber-500" : "border-commodity-border bg-commodity-card"}`}>
                              {checked && <Check className="w-2.5 h-2.5 text-slate-900" />}
                            </div>
                            <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleXId(ds.id)} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-commodity-text truncate">{ds.name}</p>
                              <p className="text-[10px] text-commodity-muted">{ds.source.toUpperCase()} · {ds.metadata.rowCount.toLocaleString()} rows</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {overlap && (
              <p className="text-xs text-commodity-muted">
                Overlapping period: <span className="text-commodity-text font-medium">{fmtDate(overlap.start)} — {fmtDate(overlap.end)}</span>{" "}
                <span className="text-amber-400 font-mono">({overlap.count.toLocaleString()} data points)</span>
              </p>
            )}
            {dsY && dsXs.length > 0 && !overlap && (
              <p className="text-xs text-red-400">No overlapping dates between the selected datasets.</p>
            )}

            <div className="flex items-center gap-4 flex-wrap">
              {mode !== "auto" && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-commodity-muted uppercase tracking-wider">Confidence:</span>
                  <div className="flex gap-1">
                    {CONF_LEVELS.map((cl) => (
                      <button key={cl.value} onClick={() => setConfLevel(cl.value)}
                        className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors ${confLevel === cl.value ? "bg-amber-500 text-slate-900" : "bg-commodity-panel border border-commodity-border text-commodity-muted hover:text-commodity-text"}`}>
                        {cl.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={handleRun} disabled={!canRun}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isLoading ? "Running…" : mode === "auto" ? "Run Stepwise" : "Run Regression"}
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!effectiveResult && !isLoading && !stepwiseResult && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <TrendingUp className="w-16 h-16 text-commodity-muted/20 mb-5" />
          <p className="text-commodity-muted text-base mb-2">Select datasets and run regression to see results</p>
          <p className="text-commodity-muted/50 text-sm">Load commodities from the{" "}
            <Link href="/data" className="text-amber-400 underline underline-offset-2">Data Hub</Link> to get started</p>
        </div>
      )}

      {/* Stepwise timeline */}
      {stepwiseResult && <StepwiseTimeline result={stepwiseResult} />}

      {/* ── B: Results ────────────────────────────────────────────────────────── */}
      {effectiveResult && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: scatter (simple) OR actual-vs-predicted (multi) */}
            {!isMultiVar ? (
              <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-commodity-text mb-1">
                  {effectiveResult.dependent_name} vs {effectiveResult.independent_names[0]}
                </h3>
                <p className="text-[11px] text-commodity-muted mb-4">Scatter with OLS line and {(confLevel * 100).toFixed(0)}% confidence band</p>
                <ResponsiveContainer width="100%" height={380}>
                  <ComposedChart margin={{ top: 12, right: 20, bottom: 32, left: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                    <XAxis type="number" dataKey="x" domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => v.toFixed(1)} axisLine={false} tickLine={false}
                      label={{ value: effectiveResult.independent_names[0], position: "insideBottom", offset: -18, fill: "#64748b", fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1)} axisLine={false} tickLine={false} width={64}
                      label={{ value: effectiveResult.dependent_name, angle: -90, position: "insideLeft", offset: 12, fill: "#64748b", fontSize: 11 }} />
                    <Area data={bandData} type="monotone" dataKey="y_upper" stroke="none" fill="#f59e0b" fillOpacity={0.15} legendType="none" activeDot={false} isAnimationActive={false} />
                    <Area data={bandData} type="monotone" dataKey="y_lower" stroke="none" fill="#1e293b" fillOpacity={1} legendType="none" activeDot={false} isAnimationActive={false} />
                    <Line data={bandData} type="linear" dataKey="regLine" stroke="#ffffff" strokeWidth={1.5} dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
                    <Scatter data={effectiveResult.scatter_data} fill="#f59e0b" fillOpacity={0.65} name="Observations" isAnimationActive={false} />
                    <Tooltip content={(props) => (
                      <ScatterTip active={props.active} payload={props.payload as unknown as ScatterPayloadItem[] | undefined}
                        depName={effectiveResult.dependent_name} xName={effectiveResult.independent_names[0]} />
                    )} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="text-sm font-semibold text-commodity-text">Actual vs Predicted</h3>
                  <span className={`font-mono text-sm font-bold ${r2Color(effectiveResult.r_squared)}`}>R² = {effectiveResult.r_squared.toFixed(4)}</span>
                </div>
                <p className="text-[11px] text-commodity-muted mb-4">Amber = actual · white dashed = predicted</p>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={effectiveResult.actual_vs_predicted} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1)} />
                    <Line type="monotone" dataKey="actual" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="predicted" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                    <Tooltip content={(raw) => {
                      const p = raw as unknown as { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string };
                      if (!p.active || !p.payload?.length) return null;
                      return (
                        <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl min-w-[140px]">
                          <p className="text-slate-400 font-mono mb-1.5 pb-1 border-b border-slate-700/60">{p.label}</p>
                          {p.payload.map((item) => (
                            <div key={item.dataKey} className="flex justify-between gap-3">
                              <span style={{ color: item.color }} className="capitalize">{item.dataKey}:</span>
                              <span className="font-mono text-slate-100">{item.value?.toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Right: model summary + coeff table */}
            <div className="space-y-4">
              <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-commodity-text mb-4">Model Summary</h3>
                <div className="grid grid-cols-2 gap-3">
                  <StatBadge label="R²" value={effectiveResult.r_squared.toFixed(4)} color={r2Color(effectiveResult.r_squared)} />
                  <StatBadge label="Adj. R²" value={effectiveResult.adj_r_squared.toFixed(4)} color={r2Color(effectiveResult.adj_r_squared)} />
                  <StatBadge label="F-Statistic" value={effectiveResult.f_statistic.toFixed(4)} sub={`p = ${formatPValue(effectiveResult.f_pvalue)}`} />
                  <StatBadge label="Observations" value={effectiveResult.num_observations.toLocaleString()} />
                  <div className="bg-commodity-panel border border-commodity-border rounded-lg p-3 col-span-2">
                    <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-1.5">Durbin-Watson</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-commodity-text font-semibold">{effectiveResult.durbin_watson.toFixed(4)}</span>
                      <span className={`text-xs ${dwInfo(effectiveResult.durbin_watson).color}`}>{dwInfo(effectiveResult.durbin_watson).label}</span>
                    </div>
                  </div>
                  <div className="bg-commodity-panel border border-commodity-border rounded-lg p-3 col-span-2">
                    <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-1.5">Jarque-Bera</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-commodity-text font-semibold">p = {formatPValue(effectiveResult.jarque_bera.p_value)}</span>
                      <span className={`text-xs ${effectiveResult.jarque_bera.p_value > 0.05 ? "text-emerald-400" : "text-red-400"}`}>
                        {effectiveResult.jarque_bera.p_value > 0.05 ? "Normal residuals" : "Non-normal residuals"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-commodity-text mb-4">Coefficients</h3>
                <CoefTable coefficients={effectiveResult.coefficients} confLevel={confLevel} />
              </div>
            </div>
          </div>

          {/* Partial regression plots (multi only) */}
          {isMultiVar && <PartialPlots plots={effectiveResult.partial_regression_data} depName={effectiveResult.dependent_name} />}

          {/* VIF panel (multi only) */}
          {isMultiVar && effectiveResult.vif_scores.length > 0 && <VifPanel scores={effectiveResult.vif_scores} />}

          {/* ── C: Residuals ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-commodity-text mb-1">Residuals over Time</h3>
              <p className="text-[11px] text-commodity-muted mb-4">Actual − Fitted · zero line = perfect fit</p>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={effectiveResult.residuals} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={60} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1)} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="residual" stroke="#64748b" strokeWidth={1}
                    dot={(props: { cx?: number; cy?: number; payload?: { residual: number } }) => (
                      <circle key={`rd-${props.cx}-${props.cy}`} cx={props.cx ?? 0} cy={props.cy ?? 0} r={2}
                        fill={(props.payload?.residual ?? 0) >= 0 ? "#10b981" : "#ef4444"} opacity={0.7} />
                    )}
                    activeDot={{ r: 4, fill: "#f59e0b" }} isAnimationActive={false} />
                  <Tooltip content={(raw) => {
                    const p = raw as unknown as { active?: boolean; payload?: { value: number }[]; label?: string };
                    if (!p.active || !p.payload?.length) return null;
                    const v = p.payload[0]?.value ?? 0;
                    return (
                      <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl">
                        <p className="text-slate-400 font-mono mb-1">{p.label}</p>
                        <p className={`font-mono font-semibold ${v >= 0 ? "text-emerald-400" : "text-red-400"}`}>{v >= 0 ? "+" : ""}{v.toFixed(4)}</p>
                      </div>
                    );
                  }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-commodity-text mb-1">Residual Distribution</h3>
              <p className="text-[11px] text-commodity-muted mb-4">Ideally bell-shaped and centred at zero</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={residualBins} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                  <Bar dataKey="count" fill="#f59e0b" fillOpacity={0.7} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Tooltip content={(raw) => {
                    const p = raw as unknown as { active?: boolean; payload?: { value: number; payload: { label: string } }[] };
                    if (!p.active || !p.payload?.length) return null;
                    return (
                      <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl">
                        <p className="text-slate-400 mb-1">Value: <span className="font-mono text-slate-200">{p.payload[0]?.payload?.label}</span></p>
                        <p className="text-amber-400 font-mono font-semibold">Count: {p.payload[0]?.value}</p>
                      </div>
                    );
                  }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Correlation heatmap */}
          {effectiveResult.correlation_matrix.columns.length > 1 && (
            <CorrelHeatmap matrix={effectiveResult.correlation_matrix} />
          )}

          {/* ── D: Interpretation ─────────────────────────────────────────────── */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-commodity-text mb-4">Interpretation</h3>
            <ul className="space-y-2.5">
              {interpret(effectiveResult).map((line, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-commodity-muted leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0 mt-1.5" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── AI Explanation ────────────────────────────────────────────────── */}
          <ExplainButton
            analysisType="regression"
            resultsSummary={{
              dependent_name: effectiveResult.dependent_name,
              independent_names: effectiveResult.independent_names,
              r_squared: effectiveResult.r_squared,
              adj_r_squared: effectiveResult.adj_r_squared,
              f_pvalue: effectiveResult.f_pvalue,
              num_observations: effectiveResult.num_observations,
              durbin_watson: effectiveResult.durbin_watson,
              coefficients: effectiveResult.coefficients.map(c => ({
                name: c.name,
                value: c.value,
                p_value: c.p_value,
                significant: c.p_value < 0.05,
              })),
            }}
            datasetNames={[effectiveResult.dependent_name, ...effectiveResult.independent_names]}
          />

          {/* ── E: Advanced Diagnostics ───────────────────────────────────────── */}
          {depSeries && indSeries && (
            <AdvancedDiagnostics depSeries={depSeries} indSeries={indSeries} />
          )}
        </>
      )}
    </div>
  );
}
