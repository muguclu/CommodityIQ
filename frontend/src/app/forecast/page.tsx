"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  TrendingUp, AlertCircle, Brain, Loader2, ChevronDown, ChevronUp,
  ChevronsUpDown, LineChart as LineChartIcon, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, RotateCcw,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Area, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Legend, Brush,
} from "recharts";
import { useCommodityStore } from "@/lib/store";
import { runForecast, analyzeSMC } from "@/lib/api";
import CandlestickSMC from "@/components/charts/CandlestickSMC";
import type { ForecastResult, ModelForecast, SMCResult, CommodityDataset } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  arima: "#f59e0b",
  ets: "#3b82f6",
  linear: "#a78bfa",
  hybrid_tft: "#10b981",
};
const MODEL_LABELS: Record<string, string> = {
  arima: "Auto-ARIMA",
  ets: "ETS",
  linear: "Linear Trend",
  hybrid_tft: "Hybrid TFT",
};

const CONF_LEVELS = [
  { label: "90%", value: 0.9 },
  { label: "95%", value: 0.95 },
  { label: "99%", value: 0.99 },
];
const RANK_MEDALS = ["🥇", "🥈", "🥉"];
const TFT_STEPS = [
  "Step 1/4: Wavelet decomposition…",
  "Step 2/4: Training TFT model (~60s)…",
  "Step 3/4: Fitting GARCH volatility…",
  "Step 4/4: Reconstructing hybrid forecast…",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPrice(v: number) {
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtAxisDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function formatXAxisTick(dateStr: string, interval: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  switch (interval) {
    case "5m":
    case "15m":
    case "1h":
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    case "1mo":
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    default:
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}
function formatTooltipDate(dateStr: string, interval: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  if (["5m", "15m", "1h"].includes(interval)) {
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function mapeColor(v: number) {
  if (v < 5) return "text-emerald-400";
  if (v < 10) return "text-amber-400";
  return "text-red-400";
}
function theilColor(v: number) { return v < 1 ? "text-emerald-400" : "text-red-400"; }

function intervalLabel(interval: string): string {
  switch (interval) {
    case "5m":  return "5-min bar";
    case "15m": return "15-min bar";
    case "1h":  return "hourly bar";
    case "1d":  return "day";
    case "1wk": return "week";
    case "1mo": return "month";
    default:    return "period";
  }
}

function intervalLabelPlural(interval: string, count: number): string {
  const label = intervalLabel(interval);
  return count === 1 ? `1 ${label}` : `${count.toLocaleString()} ${label}s`;
}

function horizonToRealTime(horizon: number, interval: string): string {
  switch (interval) {
    case "5m": {
      const totalMin = horizon * 5;
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    case "15m": {
      const totalMin = horizon * 15;
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    case "1h": {
      if (horizon < 24) return `${horizon} hours`;
      const days = Math.floor(horizon / 24);
      const hrs = horizon % 24;
      return hrs > 0 ? `${days}d ${hrs}h` : `${days} days`;
    }
    case "1d":  return `${horizon} days`;
    case "1wk": return `${horizon} weeks`;
    case "1mo": return `${horizon} months`;
    default:    return `${horizon} periods`;
  }
}

function getPresets(interval: string): { label: string; value: number }[] {
  switch (interval) {
    case "5m": return [
      { label: "30m", value: 6 }, { label: "1h", value: 12 },
      { label: "2h", value: 24 }, { label: "4h", value: 48 },
      { label: "1D", value: 78 }, { label: "1W", value: 390 },
    ];
    case "15m": return [
      { label: "1h", value: 4 }, { label: "2h", value: 8 },
      { label: "4h", value: 16 }, { label: "1D", value: 26 },
      { label: "1W", value: 130 },
    ];
    case "1h": return [
      { label: "4h", value: 4 }, { label: "8h", value: 8 },
      { label: "1D", value: 7 }, { label: "1W", value: 35 },
      { label: "2W", value: 70 }, { label: "1M", value: 140 },
    ];
    default: return [
      { label: "1W", value: 7 }, { label: "2W", value: 14 },
      { label: "1M", value: 30 }, { label: "2M", value: 60 },
      { label: "3M", value: 90 }, { label: "6M", value: 180 },
    ];
  }
}

function getZoomPresets(interval: string, histBars: number): { label: string; bars: number }[] {
  switch (interval) {
    case "5m":  return [{ label: "1h", bars: 12 }, { label: "4h", bars: 48 }, { label: "1D", bars: 78 }, { label: "All", bars: histBars }];
    case "15m": return [{ label: "2h", bars: 8 }, { label: "1D", bars: 26 }, { label: "1W", bars: 130 }, { label: "All", bars: histBars }];
    case "1h":  return [{ label: "1D", bars: 7 }, { label: "1W", bars: 35 }, { label: "1M", bars: 140 }, { label: "All", bars: histBars }];
    default:    return [{ label: "1M", bars: 22 }, { label: "3M", bars: 65 }, { label: "1Y", bars: 252 }, { label: "All", bars: histBars }];
  }
}

function getXAxisConfig(interval: string, visibleBars: number) {
  const tickEvery = Math.max(1, Math.ceil(visibleBars / 20));
  const xInterval = Math.max(0, tickEvery - 1);
  const rotate = ["5m", "15m"].includes(interval) && visibleBars > 24;

  const formatter = (s: string): string => {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    if (interval === "5m" || interval === "15m") {
      if (visibleBars <= 48)
        return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    if (interval === "1h") {
      if (visibleBars <= 24) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    if (visibleBars <= 90) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  return { xInterval, formatter, angle: rotate ? -45 : 0, textAnchor: (rotate ? "end" : "middle") as "end" | "middle", axisHeight: rotate ? 60 : 30 };
}

type SortKey = "mape" | "rmse" | "mae" | "theils_u" | "aic";
type SortDir = "asc" | "desc";

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={50}>
      <LineChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Stat helpers ─────────────────────────────────────────────────────────────

function arrMean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function arrStd(a: number[]): number {
  const m = arrMean(a);
  return a.length ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) : 0;
}
function arrVar(a: number[]): number {
  const m = arrMean(a);
  return a.length ? a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length : 0;
}
function arrQuantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ── Signal Health Panel ────────────────────────────────────────────────────────

function SignalHealthPanel({ model }: { model: ModelForecast }) {
  const p = model.parameters as Record<string, string>;
  const snrDb = parseFloat(p.snr_db ?? "0");
  const persistence = parseFloat(p.garch_persistence ?? "0");
  const regime = (p.garch_regime ?? "—").toLowerCase();
  const ciType = p.ci_type ?? "static_historical";
  const tftTrained = p.tft_trained === "True";
  const noiseNormality = p.noise_normality ?? "—";
  const tftFallback = "tft_fallback" in p;

  const snrColor = snrDb > 10 ? "text-emerald-400" : snrDb > 5 ? "text-amber-400" : "text-red-400";
  const snrQuality = snrDb > 10 ? "Good" : snrDb > 5 ? "Fair" : "Poor";
  const persColor = persistence < 0.9 ? "text-emerald-400" : persistence < 0.98 ? "text-amber-400" : "text-red-400";
  const regimeColor = regime === "low" ? "text-emerald-400" : regime === "high" ? "text-red-400" : "text-slate-400";

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-commodity-text">Signal Health — Wavelet + GARCH Diagnostics</h3>
        <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">Hybrid TFT</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Wavelet */}
        <div className="bg-commodity-panel rounded-lg p-4 space-y-2.5">
          <p className="text-[11px] text-commodity-muted uppercase tracking-wider font-medium">Wavelet Decomposition</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-xl font-bold ${snrColor}`}>{isNaN(snrDb) ? "—" : snrDb.toFixed(1)}</span>
            <span className="text-xs text-commodity-muted">dB SNR</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-commodity-muted">Signal quality</span><span className={`font-medium ${snrColor}`}>{snrQuality}</span></div>
            <div className="flex justify-between"><span className="text-commodity-muted">Wavelet</span><span className="font-mono text-commodity-text">db4 · L2</span></div>
            <div className="flex justify-between">
              <span className="text-commodity-muted">Noise dist.</span>
              <span className={`font-medium ${noiseNormality === "normal" ? "text-emerald-400" : "text-amber-400"}`}>
                {noiseNormality === "normal" ? "~Normal ✓" : "Non-normal ⚠"}
              </span>
            </div>
          </div>
        </div>
        {/* GARCH */}
        <div className="bg-commodity-panel rounded-lg p-4 space-y-2.5">
          <p className="text-[11px] text-commodity-muted uppercase tracking-wider font-medium">GARCH Volatility</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-xl font-bold ${persColor}`}>{isNaN(persistence) ? "—" : persistence.toFixed(3)}</span>
            <span className="text-xs text-commodity-muted">persistence</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-commodity-muted">Regime</span>
              <span className={`font-medium capitalize ${regimeColor}`}>{regime !== "—" ? regime : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-commodity-muted">CI bands</span>
              <span className={`font-medium ${ciType === "dynamic_garch" ? "text-emerald-400" : "text-slate-400"}`}>
                {ciType === "dynamic_garch" ? "Dynamic ✓" : "Static"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-commodity-muted">Vol clustering</span>
              <span className="text-commodity-text">{isNaN(persistence) ? "—" : persistence > 0.9 ? "Strong" : persistence > 0.7 ? "Moderate" : "Weak"}</span>
            </div>
          </div>
        </div>
        {/* TFT */}
        <div className="bg-commodity-panel rounded-lg p-4 space-y-2.5">
          <p className="text-[11px] text-commodity-muted uppercase tracking-wider font-medium">TFT Model</p>
          <div className="flex items-center gap-2 mt-1">
            {tftTrained
              ? <span className="px-2 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-400">Trained ✅</span>
              : <span className="px-2 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-400">Fallback (Linear) ⚠️</span>
            }
          </div>
          <div className="space-y-1 text-xs mt-1">
            <div className="flex justify-between">
              <span className="text-commodity-muted">Mode</span>
              <span className="text-commodity-text">{tftFallback ? "Linear extrap." : "Deep learning"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-commodity-muted">CI type</span>
              <span className={`font-medium ${ciType === "dynamic_garch" ? "text-emerald-400" : "text-slate-400"}`}>
                {ciType === "dynamic_garch" ? "Dynamic (GARCH)" : "Static (hist.)"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Signal Decomposition View ──────────────────────────────────────────────────────

function SignalDecompositionView({ model, horizon }: { model: ModelForecast; horizon: number }) {
  const [open, setOpen] = useState(false);
  const hdec = model.historical_decomposition;
  if (!hdec) return null;

  const { dates, original, trend, noise, garch_vol } = hdec;

  const chart1Data = dates.map((d, i) => ({ date: d, original: original[i], denoised: trend[i] }));

  const sigma = arrStd(noise);
  const chart2Data = dates.map((d, i) => ({ date: d, noise: noise[i] }));

  const validVols = (garch_vol ?? []).filter((v): v is number => v != null);
  const p25 = validVols.length > 0 ? arrQuantile(validVols, 0.25) : 0;
  const p75 = validVols.length > 0 ? arrQuantile(validVols, 0.75) : 0;
  const chart3Data: { date: string; histVol?: number | null; fcstVol?: number }[] = [
    ...dates.map((d, i) => ({ date: d, histVol: garch_vol?.[i] ?? null })),
    ...model.forecast_values
      .filter(fp => fp.noise_std != null)
      .map(fp => ({ date: fp.date, fcstVol: fp.noise_std! })),
  ];

  const p = model.parameters as Record<string, string>;
  const snrDb = parseFloat(p.snr_db ?? "0");
  const ciType = p.ci_type ?? "static_historical";
  const noiseVar = arrVar(noise);
  const origVar = arrVar(original);
  const noisePct = origVar > 0 ? (noiseVar / origVar * 100).toFixed(1) : "—";
  const volVals = model.forecast_values.map(fp => fp.noise_std).filter((v): v is number => v != null);
  let volDir = "stable";
  if (volVals.length >= 4) {
    const half = Math.floor(volVals.length / 2);
    const avgA = arrMean(volVals.slice(0, half));
    const avgB = arrMean(volVals.slice(half));
    if (avgB > avgA * 1.05) volDir = "increasing";
    else if (avgB < avgA * 0.95) volDir = "decreasing";
  }

  const volDirColor = volDir === "increasing" ? "text-red-400" : volDir === "decreasing" ? "text-emerald-400" : "text-slate-300";

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-commodity-panel/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">📡</span>
          <span className="text-sm font-semibold text-commodity-text">Signal Decomposition View</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-commodity-panel text-commodity-muted border border-commodity-border">
            Wavelet + GARCH Analysis
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-commodity-muted" /> : <ChevronDown className="w-4 h-4 text-commodity-muted" />}
      </button>

      {open && (
        <div className="px-5 pb-6 space-y-8 border-t border-commodity-border pt-5">

          {/* Chart 1: Original vs Denoised */}
          <div>
            <h4 className="text-xs font-semibold text-commodity-text mb-1">Original vs Denoised Price</h4>
            <p className="text-[11px] text-commodity-muted mb-3">
              Grey = raw market price · Green = wavelet-denoised trend · Gap between lines = filtered market noise
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chart1Data} margin={{ top: 8, right: 16, bottom: 20, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={fmtAxisDate}
                  minTickGap={60} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72}
                  tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`} />
                <Tooltip
                  content={(raw) => {
                    const q = raw as unknown as { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string };
                    if (!q.active || !q.payload?.length) return null;
                    const orig = q.payload.find(x => x.dataKey === "original")?.value;
                    const den = q.payload.find(x => x.dataKey === "denoised")?.value;
                    return (
                      <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl min-w-[190px]">
                        <p className="text-slate-400 font-mono mb-2 pb-1 border-b border-slate-700/60">{q.label}</p>
                        {orig != null && <div className="flex justify-between gap-3 mb-0.5"><span className="text-slate-400">Original</span><span className="font-mono text-slate-200">{fmtPrice(orig)}</span></div>}
                        {den != null && <div className="flex justify-between gap-3 mb-0.5"><span className="text-emerald-400">Denoised</span><span className="font-mono text-slate-200">{fmtPrice(den)}</span></div>}
                        {orig != null && den != null && (
                          <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-slate-700/60">
                            <span className="text-slate-500">Noise Δ</span>
                            <span className="font-mono text-slate-400">{fmtPrice(Math.abs(orig - den))}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="original" stroke="#64748b" strokeWidth={1.5} dot={false}
                  name="Original Price" isAnimationActive={false} />
                <Line type="monotone" dataKey="denoised" stroke="#10b981" strokeWidth={2.5} dot={false}
                  name="Denoised Trend (Wavelet)" isAnimationActive={false} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2: Noise Component */}
          <div>
            <h4 className="text-xs font-semibold text-commodity-text mb-1">Noise Component</h4>
            <p className="text-[11px] text-commodity-muted mb-3">
              Residual market noise after wavelet filtering ·
              <span className="text-red-400"> Red spikes</span> = extreme positive noise &gt; 2σ
              · <span className="text-emerald-400">Green spikes</span> = extreme negative noise &lt; −2σ
            </p>
            <ResponsiveContainer width="100%" height={160}>
              <ComposedChart data={chart2Data} margin={{ top: 8, right: 16, bottom: 20, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={fmtAxisDate}
                  minTickGap={60} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72}
                  tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`} />
                <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
                <ReferenceLine y={2 * sigma} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: "+2σ", position: "insideTopRight", fill: "#ef4444", fontSize: 9 }} />
                <ReferenceLine y={-2 * sigma} stroke="#10b981" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: "−2σ", position: "insideBottomRight", fill: "#10b981", fontSize: 9 }} />
                <Bar dataKey="noise" isAnimationActive={false} maxBarSize={4}>
                  {chart2Data.map((entry, idx) => (
                    <Cell key={idx}
                      fill={entry.noise > 2 * sigma ? "#ef4444" : entry.noise < -2 * sigma ? "#10b981" : "#475569"}
                      fillOpacity={Math.abs(entry.noise) > 2 * sigma ? 0.9 : 0.55}
                    />
                  ))}
                </Bar>
                <Tooltip
                  content={(raw) => {
                    const q = raw as unknown as { active?: boolean; payload?: { value: number }[]; label?: string };
                    if (!q.active || !q.payload?.length) return null;
                    const v = q.payload[0]?.value;
                    if (v == null) return null;
                    const flag = Math.abs(v) > 2 * sigma;
                    return (
                      <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2 text-xs shadow-xl">
                        <p className="text-slate-400 font-mono mb-1">{q.label}</p>
                        <p className={`font-mono ${v > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          Noise: {v >= 0 ? "+" : ""}{v.toFixed(2)}{flag ? " ⚠ Event" : ""}
                        </p>
                      </div>
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 3: GARCH Volatility Timeline */}
          {validVols.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-commodity-text mb-1">GARCH Conditional Volatility</h4>
              <p className="text-[11px] text-commodity-muted mb-3">
                Amber = historical conditional vol (training) · Dashed = forecast period ·
                <span className="text-emerald-400"> P25</span> = calm · <span className="text-red-400">P75</span> = stressed
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={chart3Data} margin={{ top: 8, right: 16, bottom: 20, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={fmtAxisDate}
                    minTickGap={60} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72}
                    tickFormatter={(v: number) => v.toFixed(2)} />
                  <ReferenceLine y={p25} stroke="#10b981" strokeDasharray="3 3" strokeWidth={1}
                    label={{ value: "P25", position: "insideTopRight", fill: "#10b981", fontSize: 9 }} />
                  <ReferenceLine y={p75} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1}
                    label={{ value: "P75", position: "insideTopRight", fill: "#ef4444", fontSize: 9 }} />
                  <Line type="monotone" dataKey="histVol" stroke="#f59e0b" strokeWidth={1.5} dot={false}
                    name="Historical Vol" isAnimationActive={false} connectNulls={false} />
                  <Line type="monotone" dataKey="fcstVol" stroke="#f59e0b" strokeWidth={1.5}
                    strokeDasharray="4 3" dot={false} name="Forecast Vol" isAnimationActive={false} />
                  <Tooltip
                    content={(raw) => {
                      const q = raw as unknown as { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string };
                      if (!q.active || !q.payload?.length) return null;
                      const vol = q.payload.find(x => x.value != null)?.value;
                      if (vol == null) return null;
                      const zone = vol < p25 ? "Low (calm)" : vol > p75 ? "High (stress)" : "Normal";
                      const zc = vol < p25 ? "text-emerald-400" : vol > p75 ? "text-red-400" : "text-slate-400";
                      return (
                        <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2 text-xs shadow-xl">
                          <p className="text-slate-400 font-mono mb-1">{q.label}</p>
                          <div className="flex justify-between gap-3"><span className="text-amber-400">Vol</span><span className="font-mono">{vol.toFixed(4)}</span></div>
                          <div className="flex justify-between gap-3"><span className="text-slate-500">Regime</span><span className={`font-medium ${zc}`}>{zone}</span></div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Summary Banner */}
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3 text-xs text-commodity-muted leading-relaxed">
            <span className="text-emerald-400 font-semibold mr-1">ℹ Insight:</span>
            The wavelet filter removed{" "}
            <span className="text-commodity-text font-semibold">{noisePct}%</span>{" "}
            of price variance as market noise (SNR:{" "}
            <span className="text-commodity-text font-semibold">{isNaN(snrDb) ? "—" : `${snrDb.toFixed(1)} dB`}</span>).{" "}
            GARCH predicts{" "}
            <span className={`font-semibold ${volDirColor}`}>{volDir}</span>{" "}
            volatility over the next{" "}
            <span className="text-commodity-text font-semibold">{horizon}</span> days.{" "}
            Confidence bands are{" "}
            <span className={`font-semibold ${ciType === "dynamic_garch" ? "text-emerald-400" : "text-slate-300"}`}>
              {ciType === "dynamic_garch" ? "dynamic (GARCH-adjusted)" : "static (historical)"}
            </span>.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Forecast Chart ─────────────────────────────────────────────────────────────

function buildChartData(result: ForecastResult) {
  type Row = Record<string, number | string | undefined>;
  const rows: Record<string, Row> = {};

  const set = (date: string, key: string, val: number) => {
    if (!rows[date]) rows[date] = { date };
    rows[date][key] = val;
  };

  result.historical.forEach((p) => set(p.date, "actual", p.value));

  result.models.forEach((m) => {
    m.backtest.predicted.forEach((p) => {
      set(p.date, `bt_${m.model_name}`, p.value);
    });
    m.forecast_values.forEach((p) => {
      set(p.date, `fc_${m.model_name}`, p.value);
      if (p.ci_lower != null) set(p.date, `ci_lo_${m.model_name}`, p.ci_lower);
      if (p.ci_upper != null) set(p.date, `ci_hi_${m.model_name}`, p.ci_upper);
      if (p.trend_component != null) set(p.date, `trend_${m.model_name}`, p.trend_component);
    });
  });

  return Object.values(rows).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function ForecastChart({ result, activeModels, showTrend = false }: { result: ForecastResult; activeModels: string[]; showTrend?: boolean }) {
  const fullData = useMemo(() => buildChartData(result), [result]);
  const interval = result.interval ?? "1d";
  const isIntraday = ["5m", "15m", "1h"].includes(interval);
  const lastHistDate = result.historical[result.historical.length - 1]?.date ?? "";
  const splitDate = result.historical[result.train_size - 1]?.date;

  const forecastStartIdx = useMemo(
    () => fullData.findIndex((row) => String(row.date) > lastHistDate),
    [fullData, lastHistDate],
  );
  const histCount = forecastStartIdx >= 0 ? forecastStartIdx : fullData.length;
  const forecastStartDate = forecastStartIdx >= 0 ? String(fullData[forecastStartIdx].date) : undefined;
  const forecastEndDate = fullData.length > 0 ? String(fullData[fullData.length - 1].date) : undefined;

  const [brush, setBrush] = useState({ start: 0, end: fullData.length - 1 });
  const endIdx = fullData.length - 1;
  useEffect(() => { setBrush({ start: 0, end: endIdx }); }, [endIdx]);

  const visibleCount = Math.max(1, brush.end - brush.start + 1);
  const zoomPresets = useMemo(() => getZoomPresets(interval, histCount), [interval, histCount]);
  const { xInterval, formatter: xFormatter, angle, textAnchor, axisHeight } = useMemo(
    () => getXAxisConfig(interval, visibleCount),
    [interval, visibleCount],
  );

  const applyPreset = (bars: number) =>
    setBrush({ start: Math.max(0, histCount - bars), end: fullData.length - 1 });

  const pan = (dir: 1 | -1) => {
    const step = Math.max(1, Math.round(visibleCount * 0.1));
    const spread = brush.end - brush.start;
    const newStart = Math.max(0, Math.min(brush.start + dir * step, fullData.length - 1 - spread));
    setBrush({ start: newStart, end: Math.min(fullData.length - 1, newStart + spread) });
  };

  const zoomIn = () => {
    const delta = Math.max(1, Math.round(visibleCount * 0.125));
    setBrush({ start: Math.min(brush.start + delta, brush.end - 2), end: Math.max(brush.end - delta, brush.start + 2) });
  };

  const zoomOut = () => {
    const delta = Math.max(1, Math.round(visibleCount * 0.125));
    setBrush({ start: Math.max(0, brush.start - delta), end: Math.min(fullData.length - 1, brush.end + delta) });
  };

  const reset = () => setBrush({ start: 0, end: fullData.length - 1 });

  const dayBoundaries = useMemo(() => {
    if (!isIntraday) return [];
    return fullData.filter((_, i) => {
      if (i === 0) return false;
      const prev = new Date(String(fullData[i - 1].date));
      const curr = new Date(String(fullData[i].date));
      return prev.getDate() !== curr.getDate();
    }).map((d) => String(d.date));
  }, [fullData, isIntraday]);

  const btnCls = "p-1.5 rounded border border-commodity-border bg-commodity-panel text-commodity-muted hover:text-commodity-text hover:border-slate-500 transition-colors";

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      {/* Header + zoom controls */}
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-commodity-text">Forecast Chart</h3>
          <p className="text-[11px] text-commodity-muted mt-0.5">
            Historical · Backtest · {result.horizon_real_time ?? `${result.forecast_horizon} periods`} forecast — Dashed = forecast · Shaded = 95% CI
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-commodity-muted uppercase tracking-wider">Zoom:</span>
          <div className="flex gap-1">
            {zoomPresets.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p.bars)}
                className="px-2 py-1 rounded text-[10px] font-mono font-medium border border-commodity-border bg-commodity-panel text-commodity-muted hover:text-commodity-text hover:bg-slate-700/40 transition-colors">
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button onClick={() => pan(-1)} className={btnCls} title="Pan left"><ChevronLeft className="w-3 h-3" /></button>
            <button onClick={() => pan(1)}  className={btnCls} title="Pan right"><ChevronRight className="w-3 h-3" /></button>
            <button onClick={zoomIn}        className={btnCls} title="Zoom in"><ZoomIn className="w-3 h-3" /></button>
            <button onClick={zoomOut}       className={btnCls} title="Zoom out"><ZoomOut className="w-3 h-3" /></button>
            <button onClick={reset}         className={btnCls} title="Reset zoom"><RotateCcw className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={520}>
        <ComposedChart data={fullData} margin={{ top: 12, right: 24, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
            tickFormatter={xFormatter} interval={xInterval}
            angle={angle} textAnchor={textAnchor} height={axisHeight} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={72}
            tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`} />

          {/* Forecast region highlight */}
          {forecastStartDate && forecastEndDate && (
            <ReferenceArea x1={forecastStartDate} x2={forecastEndDate}
              fill="#f59e0b" fillOpacity={0.04} strokeOpacity={0} />
          )}

          {/* Intraday day-boundary vertical lines */}
          {dayBoundaries.map((date) => (
            <ReferenceLine key={`db_${date}`} x={date} stroke="#334155" strokeDasharray="3 3" strokeWidth={1} />
          ))}

          {splitDate && <ReferenceLine x={splitDate} stroke="#64748b" strokeDasharray="4 4"
            label={{ value: "Train/Test", position: "top", fill: "#64748b", fontSize: 10 }} />}
          {lastHistDate && <ReferenceLine x={lastHistDate} stroke="#f59e0b" strokeDasharray="4 4"
            label={{ value: "Forecast →", position: "top", fill: "#f59e0b", fontSize: 10 }} />}

          {/* Historical actual */}
          <Line type="monotone" dataKey="actual" stroke="#64748b" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Actual" />

          {/* Per-model: CI band + backtest dashed + forecast solid */}
          {activeModels.map((m) => {
            const color = MODEL_COLORS[m] ?? "#fff";
            return (
              <React.Fragment key={m}>
                <Area type="monotone" dataKey={`ci_hi_${m}`} stroke="none" fill={color} fillOpacity={0.08}
                  legendType="none" activeDot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey={`ci_lo_${m}`} stroke="none" fill="#0f172a" fillOpacity={1}
                  legendType="none" activeDot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey={`bt_${m}`} stroke={color} strokeWidth={1.5}
                  strokeDasharray="5 3" dot={false} name={`${MODEL_LABELS[m]} (backtest)`} isAnimationActive />
                <Line type="monotone" dataKey={`fc_${m}`} stroke={color} strokeWidth={2}
                  dot={false} name={MODEL_LABELS[m] ?? m} isAnimationActive />
                {showTrend && (
                  <Line type="monotone" dataKey={`trend_${m}`} stroke={color} strokeWidth={1}
                    strokeDasharray="2 3" dot={false} name={`${MODEL_LABELS[m] ?? m} (trend)`}
                    isAnimationActive={false} strokeOpacity={0.5} />
                )}
              </React.Fragment>
            );
          })}

          <Tooltip
            content={(raw) => {
              const p = raw as unknown as { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string };
              if (!p.active || !p.payload?.length) return null;
              const items = p.payload.filter((x) => x.value != null && !String(x.dataKey).startsWith("ci_"));
              return (
                <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl min-w-[160px]">
                  <p className="text-slate-400 font-mono mb-2 pb-1 border-b border-slate-700/60">{formatTooltipDate(p.label ?? "", interval)}</p>
                  {items.map((item) => (
                    <div key={item.dataKey} className="flex justify-between gap-3 mb-0.5">
                      <span style={{ color: item.color }}>{item.dataKey === "actual" ? "Actual" : item.dataKey.replace(/^(fc|bt)_/, "").toUpperCase()}</span>
                      <span className="font-mono text-slate-100">{fmtPrice(item.value)}</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />

          {/* Drag-to-zoom brush */}
          <Brush dataKey="date" height={32} stroke="#334155" fill="#020617" travellerWidth={8}
            tickFormatter={xFormatter}
            startIndex={brush.start} endIndex={brush.end}
            onChange={(range) => {
              const r = range as { startIndex?: number; endIndex?: number };
              if (r.startIndex != null && r.endIndex != null) {
                setBrush({ start: r.startIndex, end: r.endIndex });
              }
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Model Comparison Table ─────────────────────────────────────────────────────────

function modelTypeBadge(name: string) {
  if (name === "hybrid_tft")
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-400">Deep Learning</span>;
  return <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-500/20 text-slate-400">Statistical</span>;
}

function ModelTable({ result }: { result: ForecastResult }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "mape", dir: "asc" });

  const rows = useMemo(() => {
    const base = result.models.filter((m) => !m.error && m.backtest.predicted.length > 0).map((m) => ({
      model: m,
      mape: m.backtest.metrics.mape,
      rmse: m.backtest.metrics.rmse,
      mae: m.backtest.metrics.mae,
      theils_u: m.backtest.metrics.theils_u,
      aic: m.aic ?? Infinity,
    }));
    return [...base].sort((a, b) => {
      const v = a[sort.key] - b[sort.key];
      return sort.dir === "asc" ? v : -v;
    });
  }, [result.models, sort]);

  const erroredModels = useMemo(() => result.models.filter((m) => !!m.error), [result.models]);
  const best = result.best_model;

  const Th = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sort.key === k;
    return (
      <th className="pb-2 text-right font-medium cursor-pointer select-none hover:text-commodity-text transition-colors"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "asc" ? "desc" : "asc" }))}>
        <span className="flex items-center justify-end gap-1">
          {label}
          {active ? (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 opacity-30" />}
        </span>
      </th>
    );
  };

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-commodity-text mb-1">
        Model Comparison{" "}
        <span className="text-[11px] text-commodity-muted font-normal">
          —{" "}
          {["5m", "15m", "1h"].includes(result.interval ?? "1d")
            ? `${result.forecast_horizon} × ${intervalLabel(result.interval ?? "1d")}s (${result.horizon_real_time ?? ""})`
            : (result.horizon_real_time ?? `${result.forecast_horizon} periods`)} forecast
        </span>
      </h3>
      <div className="mb-4" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-commodity-muted uppercase tracking-wider border-b border-commodity-border">
              <th className="pb-2 text-left font-medium">Model</th>
              <th className="pb-2 text-left font-medium">Type</th>
              <th className="pb-2 text-left font-medium">Parameters</th>
              <Th k="mape" label="MAPE" />
              <Th k="rmse" label="RMSE" />
              <Th k="mae" label="MAE" />
              <Th k="theils_u" label="Theil's U" />
              <Th k="aic" label="AIC" />
              <th className="pb-2 text-right font-medium">Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const m = row.model;
              const isBest = m.model_name === best;
              const color = MODEL_COLORS[m.model_name] ?? "#fff";
              const SKIP = new Set(["snr_db","garch_regime","ci_type","tft_trained","noise_normality","tft_fallback"]);
              const params = Object.entries(m.parameters)
                .filter(([k]) => !SKIP.has(k)).slice(0, 4)
                .map(([k, v]) => `${k}=${v}`).join(", ");
              return (
                <tr key={m.model_name}
                  className={`border-b border-commodity-border/40 transition-colors ${isBest ? "bg-amber-500/5" : "hover:bg-commodity-panel/60"}`}>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-medium text-commodity-text">{m.display_name}</span>
                      {isBest && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">★ Best</span>}
                    </div>
                  </td>
                  <td className="py-3 pr-3">{modelTypeBadge(m.model_name)}</td>
                  <td className="py-3 pr-4 font-mono text-[10px] text-commodity-muted max-w-[140px] truncate">{params || "—"}</td>
                  <td className={`py-3 text-right font-mono font-semibold ${mapeColor(row.mape)}`}>{row.mape.toFixed(2)}%</td>
                  <td className="py-3 text-right font-mono text-commodity-text">{row.rmse.toFixed(2)}</td>
                  <td className="py-3 text-right font-mono text-commodity-text">{row.mae.toFixed(2)}</td>
                  <td className={`py-3 text-right font-mono font-semibold ${theilColor(row.theils_u)}`}>{row.theils_u.toFixed(3)}</td>
                  <td className="py-3 text-right font-mono text-commodity-muted">{m.aic != null ? m.aic.toFixed(1) : "—"}</td>
                  <td className="py-3 text-right">{RANK_MEDALS[i] ?? `#${i + 1}`}</td>
                </tr>
              );
            })}
            {erroredModels.map((m) => {
              const color = MODEL_COLORS[m.model_name] ?? "#fff";
              return (
                <tr key={m.model_name} className="border-b border-commodity-border/40 opacity-60">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-medium text-commodity-text">{m.display_name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-3">{modelTypeBadge(m.model_name)}</td>
                  <td colSpan={7} className="py-3 text-red-400 text-[11px]">⚠ {m.error}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ result }: { result: ForecastResult }) {
  const interval = result.interval ?? "1d";
  const isIntraday = ["5m", "15m", "1h"].includes(interval);

  const ranked = useMemo(() => {
    const ok = result.models.filter((m) => !m.error && m.forecast_values.length > 0);
    return [...ok].sort((a, b) => a.backtest.metrics.mape - b.backtest.metrics.mape);
  }, [result.models]);

  const currentPrice = result.historical[result.historical.length - 1]?.value ?? 0;

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {ranked.map((m, i) => {
        const firstFc = m.forecast_values[0];
        const lastFc = m.forecast_values[m.forecast_values.length - 1];
        if (!firstFc || !lastFc) return null;
        const firstChange = firstFc.value - currentPrice;
        const firstChangePct = currentPrice > 0 ? (firstChange / currentPrice) * 100 : 0;
        const lastChange = lastFc.value - currentPrice;
        const lastChangePct = currentPrice > 0 ? (lastChange / currentPrice) * 100 : 0;
        const color = MODEL_COLORS[m.model_name] ?? "#fff";
        const sparkValues = m.forecast_values.map((p) => p.value);
        const isFirstPos = firstChange >= 0;
        const isLastPos = lastChange >= 0;
        return (
          <div key={m.model_name}
            className="flex-shrink-0 w-60 bg-commodity-card border border-commodity-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs font-semibold text-commodity-text truncate max-w-[120px]">{m.display_name}</span>
              </div>
              <span className="text-sm">{RANK_MEDALS[i] ?? ""}</span>
            </div>

            {/* Primary: next bar (intraday) or terminal (daily) */}
            <p className="text-[10px] text-commodity-muted mb-0.5">
              {isIntraday ? "Next bar:" : `Price in ${result.horizon_real_time ?? `${result.forecast_horizon}d`}:`}
            </p>
            <p className="font-mono text-lg font-bold text-commodity-text">{fmtPrice(firstFc.value)}</p>
            <p className={`font-mono text-xs font-semibold mt-0.5 ${isFirstPos ? "text-emerald-400" : "text-red-400"}`}>
              {isFirstPos ? "+" : ""}{fmtPrice(firstChange)} ({isFirstPos ? "+" : ""}{firstChangePct.toFixed(2)}%)
            </p>
            {firstFc.ci_lower != null && firstFc.ci_upper != null && (
              <p className="text-[10px] text-commodity-muted mt-0.5">
                CI: {fmtPrice(firstFc.ci_lower)} — {fmtPrice(firstFc.ci_upper)}
              </p>
            )}

            {/* Secondary: terminal forecast for intraday only */}
            {isIntraday && m.forecast_values.length > 1 && (
              <>
                <div className="border-t border-commodity-border/50 my-2" />
                <p className="text-[10px] text-commodity-muted mb-0.5">
                  Terminal ({result.forecast_horizon} bars):
                </p>
                <p className="font-mono text-sm font-semibold text-commodity-text">{fmtPrice(lastFc.value)}</p>
                <p className={`font-mono text-[10px] font-medium ${isLastPos ? "text-emerald-400" : "text-red-400"}`}>
                  {isLastPos ? "+" : ""}{fmtPrice(lastChange)} ({isLastPos ? "+" : ""}{lastChangePct.toFixed(2)}%)
                </p>
              </>
            )}

            <div className="mt-2">
              <Sparkline values={sparkValues} color={color} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Interpretation ─────────────────────────────────────────────────────────────

function Interpretation({ result }: { result: ForecastResult }) {
  const interval = result.interval ?? "1d";
  const isIntraday = ["5m", "15m", "1h"].includes(interval);
  const best = result.models.find((m) => m.model_name === result.best_model);
  if (!best) return null;
  const firstFc = best.forecast_values[0];
  const lastFc = best.forecast_values[best.forecast_values.length - 1];
  const currentPrice = result.historical[result.historical.length - 1]?.value ?? 0;
  if (!firstFc || !lastFc) return null;

  const firstChange = ((firstFc.value - currentPrice) / currentPrice) * 100;
  const direction = firstFc.value >= currentPrice ? "rise" : "fall";
  const spread = lastFc.ci_upper != null && lastFc.ci_lower != null
    ? lastFc.ci_upper - lastFc.ci_lower : null;
  const realTime = result.horizon_real_time ?? `${result.forecast_horizon} periods`;
  const barLabel = intervalLabelPlural(interval, result.forecast_horizon);

  const lines = isIntraday ? [
    `${best.display_name} is the recommended model with the lowest MAPE of ${best.backtest.metrics.mape.toFixed(2)}%.`,
    `${best.display_name} forecasts the next ${intervalLabel(interval)} at ${fmtPrice(firstFc.value)} (${firstChange >= 0 ? "+" : ""}${firstChange.toFixed(2)}% ${direction}).`,
    `Over ${barLabel} (${realTime}), the terminal forecast is ${fmtPrice(lastFc.value)}.`,
    lastFc.ci_lower != null && lastFc.ci_upper != null
      ? `Terminal 95% CI: ${fmtPrice(lastFc.ci_lower)} — ${fmtPrice(lastFc.ci_upper)}, a range of ${spread != null ? fmtPrice(spread) : "—"}.`
      : null,
  ].filter(Boolean) as string[] : [
    `${best.display_name} is the recommended model with the lowest MAPE of ${best.backtest.metrics.mape.toFixed(2)}%.`,
    `The model forecasts ${result.dataset_name} (${interval}) to ${direction} to ${fmtPrice(lastFc.value)} over the next ${realTime}.`,
    lastFc.ci_lower != null && lastFc.ci_upper != null
      ? `The 95% confidence interval at the forecast horizon is ${fmtPrice(lastFc.ci_lower)} — ${fmtPrice(lastFc.ci_upper)}, a range of ${spread != null ? fmtPrice(spread) : "—"}.`
      : null,
    result.forecast_horizon > 90
      ? "⚠️ Note: Long-horizon forecasts (>90 days) have significantly wider confidence intervals and should be used directionally, not for precise price targets."
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-commodity-text mb-4">Interpretation</h3>
      <ul className="space-y-2.5">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-commodity-muted leading-relaxed">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0 mt-1.5" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── SMC Section ───────────────────────────────────────────────────────────────

type SMCToggles = {
  swingPoints: boolean; structureLabels: boolean; breaks: boolean;
  supplyDemand: boolean; liquidity: boolean; volume: boolean;
};

function SMCSection({
  ds, smcResult, smcLoading, smcError, smcToggles, setSmcToggles,
  visibleBars, setVisibleBars, swingSensitivity, setSwingSensitivity, onReanalyze,
}: {
  ds: CommodityDataset;
  smcResult: SMCResult | null;
  smcLoading: boolean;
  smcError: string | null;
  smcToggles: SMCToggles;
  setSmcToggles: React.Dispatch<React.SetStateAction<SMCToggles>>;
  visibleBars: number;
  setVisibleBars: React.Dispatch<React.SetStateAction<number>>;
  swingSensitivity: number;
  setSwingSensitivity: React.Dispatch<React.SetStateAction<number>>;
  onReanalyze: () => void;
}) {
  const hasOHLCV = ds.records.length > 0 && ds.records[0].open != null && ds.records[0].high != null;
  const hasEnoughData = ds.records.length >= 50;

  const TOGGLES: { key: keyof SMCToggles; label: string }[] = [
    { key: "swingPoints",     label: "Swing Points" },
    { key: "structureLabels", label: "Structure Labels" },
    { key: "breaks",          label: "MSB / BOS" },
    { key: "supplyDemand",    label: "Supply & Demand" },
    { key: "liquidity",       label: "Liquidity" },
    { key: "volume",          label: "Volume" },
  ];

  const summary      = smcResult?.summary;
  const lastClose    = smcResult?.candles[smcResult.candles.length - 1]?.close;
  const activeSupply = smcResult?.zones.filter(z => z.type === "supply" && z.strength !== "broken") ?? [];
  const activeDemand = smcResult?.zones.filter(z => z.type === "demand" && z.strength !== "broken") ?? [];
  const unsweptPools = smcResult?.liquidity_pools.filter(p => !p.swept) ?? [];
  const lastBreak    = summary?.last_break;

  const smcLines: string[] = smcResult && summary ? ([
    `Market structure is ${summary.current_bias} based on recent ${summary.current_bias === "bullish" ? "HH/HL" : "LH/LL"} sequence.`,
    lastBreak
      ? `The most recent signal was a ${lastBreak.direction === "bullish" ? "Bullish" : "Bearish"} ${lastBreak.type} at ${fmtPrice(lastBreak.broken_level)} — this ${lastBreak.type === "MSB" ? "reverses" : "confirms"} the current trend.`
      : null,
    activeSupply.length > 0
      ? `Key supply zone at ${fmtPrice(activeSupply[0].top)} (${activeSupply[0].strength}) — price may reject here.`
      : null,
    activeDemand.length > 0
      ? `Key demand zone at ${fmtPrice(activeDemand[activeDemand.length - 1].top)} (${activeDemand[activeDemand.length - 1].strength}) — potential buying area.`
      : null,
    unsweptPools.length > 0
      ? `${unsweptPools.length} unswept liquidity pool${unsweptPools.length > 1 ? "s" : ""} detected — these may act as price magnets.`
      : null,
  ].filter(Boolean) as string[]) : [];

  return (
    <div className="bg-commodity-card border border-commodity-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-commodity-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-base">🏦</span>
          <div>
            <h3 className="text-sm font-semibold text-commodity-text">Smart Money Analysis — Market Structure &amp; Liquidity</h3>
            <p className="text-[11px] text-commodity-muted">{ds.name} · {ds.records.length.toLocaleString()} bars · {ds.interval ?? "1d"}</p>
          </div>
        </div>
        <button
          onClick={onReanalyze}
          disabled={!hasOHLCV || !hasEnoughData || smcLoading}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          {smcLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Re-analyze
        </button>
      </div>

      {!hasOHLCV ? (
        <div className="px-6 py-12 text-center">
          <AlertCircle className="w-10 h-10 text-commodity-muted/30 mx-auto mb-3" />
          <p className="text-sm text-commodity-muted font-medium">SMC analysis requires OHLCV data (Open, High, Low, Close, Volume)</p>
          <p className="text-xs text-commodity-muted/60 mt-1.5">Load a dataset with full OHLCV columns to enable this feature.</p>
        </div>
      ) : !hasEnoughData ? (
        <div className="px-6 py-12 text-center">
          <AlertCircle className="w-10 h-10 text-commodity-muted/30 mx-auto mb-3" />
          <p className="text-sm text-commodity-muted font-medium">Not enough data for SMC analysis. Load at least 50 bars.</p>
          <p className="text-xs text-commodity-muted/60 mt-1.5">Current dataset has {ds.records.length} bars.</p>
        </div>
      ) : (
        <div className="p-6 space-y-5">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3 px-4 bg-commodity-panel rounded-lg border border-commodity-border">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {TOGGLES.map(({ key, label }) => {
                const checked = smcToggles[key];
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer select-none group"
                    onClick={() => setSmcToggles(t => ({ ...t, [key]: !t[key] }))}
                  >
                    <div className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${checked ? "bg-amber-500 border-amber-500" : "border-commodity-border bg-commodity-card"}`}>
                      {checked && <svg viewBox="0 0 10 8" className="w-2 h-2 fill-none stroke-slate-900 stroke-[1.5]"><path d="M1 4l3 3 5-6"/></svg>}
                    </div>
                    <span className="text-xs text-commodity-muted group-hover:text-commodity-text transition-colors">{label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4 ml-auto items-center">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-commodity-muted whitespace-nowrap">Visible Bars</span>
                <input type="range" min={50} max={Math.min(500, ds.records.length)} value={visibleBars}
                  onChange={e => setVisibleBars(+e.target.value)} className="w-24 accent-amber-500" />
                <span className="text-[11px] font-mono text-amber-400 w-9">{visibleBars}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-commodity-muted whitespace-nowrap">Swing Sensitivity</span>
                <input type="range" min={2} max={10} value={swingSensitivity}
                  onChange={e => setSwingSensitivity(+e.target.value)} className="w-16 accent-amber-500" />
                <span className="text-[11px] font-mono text-amber-400 w-4">{swingSensitivity}</span>
              </div>
            </div>
          </div>

          {/* Loading */}
          {smcLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 bg-commodity-panel rounded-xl border border-commodity-border">
              <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
              <p className="text-sm text-commodity-muted">Detecting market structure &amp; liquidity pools…</p>
            </div>
          )}

          {/* API Error */}
          {smcError && !smcLoading && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{smcError}</span>
            </div>
          )}

          {/* Chart + Cards + Interpretation */}
          {smcResult && !smcLoading && (
            <>
              <CandlestickSMC
                data={smcResult}
                height={500}
                showSwingPoints={smcToggles.swingPoints}
                showStructureLabels={smcToggles.structureLabels}
                showBreaks={smcToggles.breaks}
                showSupplyDemand={smcToggles.supplyDemand}
                showLiquidity={smcToggles.liquidity}
                showVolume={smcToggles.volume}
              />

              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Card 1: Bias */}
                <div className="bg-commodity-panel border border-commodity-border rounded-xl p-4">
                  <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-3">Current Bias</p>
                  <div className={`flex items-baseline gap-2 ${summary!.current_bias === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                    <span className="font-mono text-2xl font-bold uppercase">{summary!.current_bias}</span>
                    <span className="text-2xl leading-none">{summary!.current_bias === "bullish" ? "↑" : "↓"}</span>
                  </div>
                  <p className="text-[11px] text-commodity-muted mt-2">Based on recent structure sequence</p>
                  <div className="mt-3 flex gap-3 text-xs text-commodity-muted">
                    <span>{summary!.total_swing_points} swings</span>
                    <span>·</span>
                    <span>{summary!.total_breaks} breaks</span>
                  </div>
                </div>

                {/* Card 2: Key Levels */}
                <div className="bg-commodity-panel border border-commodity-border rounded-xl p-4">
                  <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-3">Key Levels</p>
                  <div className="space-y-2">
                    {summary!.nearest_supply != null && (
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-red-400">Nearest Supply</span>
                        <span className="font-mono text-xs font-semibold text-red-400">{fmtPrice(summary!.nearest_supply)}</span>
                      </div>
                    )}
                    {lastClose != null && (
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-commodity-muted">Current Price</span>
                        <span className="font-mono text-xs font-semibold text-commodity-text">{fmtPrice(lastClose)}</span>
                      </div>
                    )}
                    {summary!.nearest_demand != null && (
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-emerald-400">Nearest Demand</span>
                        <span className="font-mono text-xs font-semibold text-emerald-400">{fmtPrice(summary!.nearest_demand)}</span>
                      </div>
                    )}
                    {summary!.nearest_supply == null && summary!.nearest_demand == null && (
                      <p className="text-xs text-commodity-muted">No active zones detected</p>
                    )}
                  </div>
                </div>

                {/* Card 3: Structure Breaks */}
                <div className="bg-commodity-panel border border-commodity-border rounded-xl p-4">
                  <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-3">Structure Breaks</p>
                  {lastBreak ? (
                    <div className="space-y-2">
                      <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded ${lastBreak.type === "MSB" ? "bg-amber-500/20 text-amber-400" : "bg-slate-500/20 text-slate-400"}`}>
                        {lastBreak.direction === "bullish" ? "Bullish" : "Bearish"} {lastBreak.type}
                      </span>
                      <p className="text-xs text-commodity-muted">at <span className="font-mono text-commodity-text">{fmtPrice(lastBreak.broken_level)}</span></p>
                    </div>
                  ) : (
                    <p className="text-xs text-commodity-muted">No breaks detected</p>
                  )}
                  <div className="mt-3 flex gap-3 text-xs">
                    <span><span className="font-mono text-amber-400">{summary!.msb_count}</span> <span className="text-commodity-muted">MSB</span></span>
                    <span className="text-commodity-muted">·</span>
                    <span><span className="font-mono text-slate-400">{summary!.bos_count}</span> <span className="text-commodity-muted">BOS</span></span>
                  </div>
                </div>

                {/* Card 4: Liquidity */}
                <div className="bg-commodity-panel border border-commodity-border rounded-xl p-4">
                  <p className="text-[10px] text-commodity-muted uppercase tracking-wider mb-3">Liquidity Pools</p>
                  <div className="flex items-baseline gap-1.5 mb-3">
                    <span className="font-mono text-2xl font-bold text-amber-400">{summary!.unswept_liquidity}</span>
                    <span className="text-xs text-commodity-muted">unswept pools</span>
                  </div>
                  <div className="space-y-1.5">
                    {unsweptPools.slice(0, 2).map((p, i) => (
                      <div key={i} className="flex justify-between items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${p.type === "EQH" ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                          {p.type}
                        </span>
                        <span className="font-mono text-[10px] text-commodity-text flex-1 text-right">{fmtPrice(p.price)}</span>
                        <span className="text-[10px] text-commodity-muted">{p.num_touches}×</span>
                      </div>
                    ))}
                    {unsweptPools.length === 0 && (
                      <p className="text-xs text-commodity-muted">All pools swept</p>
                    )}
                  </div>
                </div>
              </div>

              {/* SMC Interpretation */}
              {smcLines.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-5">
                  <h4 className="text-sm font-semibold text-commodity-text mb-3">SMC Interpretation</h4>
                  <ul className="space-y-2">
                    {smcLines.map((line, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-commodity-muted leading-relaxed">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0 mt-1.5" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  const [mounted, setMounted] = useState(false);
  const { datasets } = useCommodityStore();

  const [selectedId, setSelectedId] = useState("");
  const [horizon, setHorizon] = useState(30);
  const [models, setModels] = useState(["arima", "ets", "linear"]);
  const [split, setSplit] = useState(0.8);
  const [confLevel, setConfLevel] = useState(0.95);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [tftStep, setTftStep] = useState(0);
  const [showTrend, setShowTrend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const tftTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [smcResult, setSmcResult] = useState<SMCResult | null>(null);
  const [smcLoading, setSmcLoading] = useState(false);
  const [smcError, setSmcError] = useState<string | null>(null);
  const [smcToggles, setSmcToggles] = useState<SMCToggles>({
    swingPoints: true, structureLabels: true, breaks: true,
    supplyDemand: true, liquidity: true, volume: true,
  });
  const [visibleBars, setVisibleBars] = useState(200);
  const [swingSensitivity, setSwingSensitivity] = useState(5);

  useEffect(() => { setMounted(true); }, []);

  const ds = useMemo(() => datasets.find((d) => d.id === selectedId), [datasets, selectedId]);
  const interval = ds?.interval ?? "1d";
  const presets = useMemo(() => getPresets(interval), [interval]);
  const sliderMax = useMemo(() => Math.max(...presets.map((p) => p.value)), [presets]);

  const trainCount = useMemo(() => ds ? Math.floor(ds.records.length * split) : 0, [ds, split]);
  const testCount = useMemo(() => ds ? ds.records.length - trainCount : 0, [ds, trainCount]);

  const toggleModel = (m: string) =>
    setModels((p) => p.includes(m) ? p.filter((x) => x !== m) : [...p, m]);

  const handleRun = useCallback(async () => {
    if (!ds || models.length === 0) return;
    setIsLoading(true); setError(null); setResult(null); setLoadingStep(0); setShowTrend(false);

    tftTimersRef.current.forEach(clearTimeout);
    tftTimersRef.current = [];
    if (models.includes("hybrid_tft")) {
      setTftStep(0);
      tftTimersRef.current.push(setTimeout(() => setTftStep(1), 5000));
      tftTimersRef.current.push(setTimeout(() => setTftStep(2), 30000));
      tftTimersRef.current.push(setTimeout(() => setTftStep(3), 60000));
    }

    const stepTimer = setInterval(() => setLoadingStep((p) => Math.min(p + 1, models.length - 1)), 2500);
    try {
      const res = await runForecast({
        name: ds.name,
        values: ds.records.map((r) => r.close),
        dates: ds.records.map((r) => r.date),
        horizon,
        models,
        confidence_level: confLevel,
        train_test_split: split,
        interval: ds.interval ?? "1d",
      });
      setResult(res);
      setTimeout(() => chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Forecast failed. Please try again.");
    } finally {
      clearInterval(stepTimer);
      tftTimersRef.current.forEach(clearTimeout);
      tftTimersRef.current = [];
      setIsLoading(false);
      setLoadingStep(0);
      setTftStep(0);
    }
  }, [ds, models, horizon, confLevel, split]);

  const runSMCAnalysis = useCallback(async (dataset: CommodityDataset, lookback: number, bars: number) => {
    setSmcLoading(true);
    setSmcError(null);
    setSmcResult(null);
    try {
      const res = await analyzeSMC({
        name: dataset.name,
        dates:   dataset.records.map(r => r.date),
        opens:   dataset.records.map(r => r.open   ?? 0),
        highs:   dataset.records.map(r => r.high   ?? 0),
        lows:    dataset.records.map(r => r.low    ?? 0),
        closes:  dataset.records.map(r => r.close),
        volumes: dataset.records.map(r => r.volume ?? 0),
        interval:      dataset.interval ?? "1d",
        swing_lookback: lookback,
        visible_bars:   bars,
      });
      setSmcResult(res);
    } catch (e: unknown) {
      setSmcError(e instanceof Error ? e.message : "SMC analysis failed.");
    } finally {
      setSmcLoading(false);
    }
  }, []);

  const handleSMCAnalyze = useCallback(() => {
    if (!ds) return;
    runSMCAnalysis(ds, swingSensitivity, visibleBars);
  }, [ds, runSMCAnalysis, swingSensitivity, visibleBars]);

  useEffect(() => {
    setSmcResult(null);
    setSmcError(null);
    if (!ds) return;
    const hasOHLCV = ds.records.length > 0 && ds.records[0].open != null && ds.records[0].high != null;
    if (!hasOHLCV || ds.records.length < 50) return;
    runSMCAnalysis(ds, 5, 200);
  }, [ds, runSMCAnalysis]);

  if (!mounted) return null;

  const MODEL_OPTIONS = [
    { id: "arima",      label: "Auto-ARIMA",                 color: MODEL_COLORS.arima },
    { id: "ets",        label: "Exponential Smoothing (ETS)", color: MODEL_COLORS.ets },
    { id: "linear",     label: "Linear Trend",               color: MODEL_COLORS.linear },
    { id: "hybrid_tft", label: "Hybrid TFT + Wavelet",       color: MODEL_COLORS.hybrid_tft },
  ];

  return (
    <div className="p-6 md:p-8 animate-fade-in space-y-6 max-w-screen-2xl">

      {/* ── A: Config Panel ────────────────────────────────────────────────── */}
      <div className="bg-commodity-card border border-commodity-border rounded-xl p-6 space-y-6">
        <h2 className="text-sm font-semibold text-commodity-text">Forecast Configuration</h2>

        {/* Row 1 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Dataset */}
          <div>
            <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Select Dataset</label>
            {datasets.length === 0 ? (
              <p className="text-xs text-commodity-muted">
                No datasets loaded.{" "}
                <Link href="/data" className="text-amber-400 underline">Go to Data Hub →</Link>
              </p>
            ) : (
              <div className="relative">
                <select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setResult(null); }}
                  className="w-full bg-[#0f172a] border border-commodity-border text-slate-100 text-sm rounded-lg px-3 py-2.5 appearance-none cursor-pointer hover:border-slate-500 transition-colors focus:outline-none focus:border-amber-500/50">
                  <option value="" className="bg-[#0f172a] text-slate-400">Select dataset…</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id} className="bg-[#0f172a] text-slate-100">
                      {d.name} · {d.source.toUpperCase()} · {d.metadata.rowCount.toLocaleString()} rows · {d.dateRange.start.slice(0, 10)} – {d.dateRange.end.slice(0, 10)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-commodity-muted pointer-events-none" />
              </div>
            )}
          </div>

          {/* Horizon */}
          <div>
            <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">
              Forecast Horizon —{" "}
              <span className="text-amber-400 font-mono normal-case">
                {["1d", "1wk", "1mo"].includes(interval)
                  ? horizonToRealTime(horizon, interval)
                  : `${horizon} bars (${horizonToRealTime(horizon, interval)})`}
              </span>
            </label>
            <input type="range" min={1} max={sliderMax} value={horizon} onChange={(e) => setHorizon(+e.target.value)}
              className="w-full accent-amber-500 mb-3" />
            <div className="flex gap-1 flex-wrap">
              {presets.map((p) => (
                <button key={p.value} onClick={() => setHorizon(p.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors ${horizon === p.value ? "bg-amber-500 text-slate-900" : "bg-commodity-panel border border-commodity-border text-commodity-muted hover:text-commodity-text"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Models */}
          <div>
            <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Models</label>
            <div className="space-y-2">
              {MODEL_OPTIONS.map((opt) => {
                const checked = models.includes(opt.id);
                return (
                  <React.Fragment key={opt.id}>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${checked ? "border-transparent" : "border-commodity-border bg-commodity-card"}`}
                      style={checked ? { backgroundColor: opt.color } : {}}>
                      {checked && <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-none stroke-slate-900 stroke-[1.5]"><path d="M1 4l3 3 5-6"/></svg>}
                    </div>
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleModel(opt.id)} />
                    <span className="text-xs text-commodity-text group-hover:text-commodity-text/90">{opt.label}</span>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
                  </label>
                  {opt.id === "hybrid_tft" && (
                    <div className="ml-7 space-y-0.5">
                      <p className="text-[10px] text-emerald-400/80">⚡ Deep learning + wavelet denoising + GARCH volatility.</p>
                      <p className="text-[10px] text-amber-400/70">⚠ Requires 200+ data points. Training may take 1–2 min on CPU.</p>
                    </div>
                  )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Split */}
          <div>
            <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Train/Test Split</label>
            <input type="range" min={0.6} max={0.9} step={0.05} value={split} onChange={(e) => setSplit(+e.target.value)}
              className="w-full accent-amber-500 mb-2" />
            <p className="text-xs text-commodity-muted font-mono">
              Training: <span className="text-emerald-400">{intervalLabelPlural(interval, trainCount)}</span>
              {" "}· Testing: <span className="text-amber-400">{intervalLabelPlural(interval, testCount)}</span>
            </p>
            <p className="text-[11px] text-commodity-muted mt-0.5">{Math.round(split * 100)}% / {Math.round((1 - split) * 100)}%</p>
          </div>

          {/* Confidence */}
          <div>
            <label className="block text-[11px] text-commodity-muted uppercase tracking-wider mb-2">Confidence Level</label>
            <div className="flex gap-1.5">
              {CONF_LEVELS.map((cl) => (
                <button key={cl.value} onClick={() => setConfLevel(cl.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${confLevel === cl.value ? "bg-amber-500 text-slate-900" : "bg-commodity-panel border border-commodity-border text-commodity-muted hover:text-commodity-text"}`}>
                  {cl.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: Run button */}
        <div>
          <button onClick={handleRun} disabled={!selectedId || models.length === 0 || isLoading}
            className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {isLoading && models.includes("hybrid_tft")
              ? (<><Loader2 className="w-4 h-4 animate-spin" />{TFT_STEPS[tftStep]}</>)
              : isLoading
              ? (<><Loader2 className="w-4 h-4 animate-spin" />Running {MODEL_LABELS[models[loadingStep]] ?? "models"}… ({loadingStep + 1}/{models.length})</>)
              : (<><TrendingUp className="w-4 h-4" />Run Forecast</>)}
          </button>
          {isLoading && models.includes("hybrid_tft") && (
            <p className="text-[10px] text-amber-400/80 text-center mt-1.5 leading-relaxed">
              Running Hybrid TFT… This may take 1–2 minutes on CPU. Please wait.
            </p>
          )}
          {error && (
            <div className="flex items-start gap-2 mt-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!result && !isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <LineChartIcon className="w-16 h-16 text-commodity-muted/20 mb-5" />
          <p className="text-commodity-muted text-base mb-2">Select a dataset and configure the forecast parameters</p>
          <p className="text-commodity-muted/50 text-sm">
            Tip: Compare all three models to see which captures the trend best
          </p>
        </div>
      )}

      {/* ── B–E: Results ────────────────────────────────────────────────────── */}
      {result && (
        <>
          <div ref={chartRef}>
            {result.models.some((m) => m.model_name === "hybrid_tft" && !m.error &&
              m.forecast_values.some((p) => p.trend_component != null)) && (
              <div className="flex justify-end mb-2">
                <button onClick={() => setShowTrend((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    showTrend
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "bg-commodity-panel text-commodity-muted border-commodity-border hover:text-commodity-text"
                  }`}>
                  {showTrend ? "Hide" : "Show"} Trend Component
                </button>
              </div>
            )}
            <ForecastChart result={result}
              activeModels={models.filter((m) => result.models.some((r) => r.model_name === m && !r.error))}
              showTrend={showTrend} />
          </div>
          {result.models.find((m) => m.model_name === "hybrid_tft" && !m.error) && (
            <SignalHealthPanel model={result.models.find((m) => m.model_name === "hybrid_tft" && !m.error)!} />
          )}
          {result.models.find((m) => m.model_name === "hybrid_tft" && !m.error && m.historical_decomposition != null) && (
            <SignalDecompositionView
              model={result.models.find((m) => m.model_name === "hybrid_tft" && !m.error)!}
              horizon={result.forecast_horizon}
            />
          )}
          <ModelTable result={result} />
          <SummaryCards result={result} />
          <Interpretation result={result} />
        </>
      )}

      {/* ── SMC Analysis ────────────────────────────────────────────────────── */}
      {ds && (
        <SMCSection
          ds={ds}
          smcResult={smcResult}
          smcLoading={smcLoading}
          smcError={smcError}
          smcToggles={smcToggles}
          setSmcToggles={setSmcToggles}
          visibleBars={visibleBars}
          setVisibleBars={setVisibleBars}
          swingSensitivity={swingSensitivity}
          setSwingSensitivity={setSwingSensitivity}
          onReanalyze={handleSMCAnalyze}
        />
      )}
    </div>
  );
}
