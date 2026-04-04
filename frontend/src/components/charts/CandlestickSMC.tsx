"use client";

import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { SMCResult } from "@/lib/types";

interface CandlestickSMCProps {
  data: SMCResult;
  height?: number;
  showSwingPoints?: boolean;
  showStructureLabels?: boolean;
  showBreaks?: boolean;
  showSupplyDemand?: boolean;
  showLiquidity?: boolean;
  showVolume?: boolean;
}

const ML = 74;
const MR = 16;
const MT = 16;
const MB = 72;
const VOL_H = 52;
const MIN_VIEW = 8;

export default function CandlestickSMC({
  data,
  height = 650,
  showSwingPoints = true,
  showStructureLabels = true,
  showBreaks = true,
  showSupplyDemand = true,
  showLiquidity = true,
  showVolume = true,
}: CandlestickSMCProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [svgWidth, setSvgWidth] = useState(900);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [grabbing,  setGrabbing]  = useState(false);

  const n = data.candles.length;
  const defaultView = Math.min(n, 120);

  const [viewStart, setViewStart] = useState(() => Math.max(0, n - defaultView));
  const [viewCount, setViewCount] = useState(() => defaultView);


  // ── Resize observer ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setSvgWidth(e[0].contentRect.width));
    ro.observe(el);
    setSvgWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── Non-passive wheel listener ──
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor  = e.deltaY > 0 ? 1.13 : 0.88;
      const newCount = Math.round(viewCount * factor);
      const rect    = el.getBoundingClientRect();
      const mx      = e.clientX - rect.left;
      const chartW  = rect.width - ML - MR;
      const ratio   = Math.max(0, Math.min(1, (mx - ML) / chartW));
      const anchor  = viewStart + ratio * viewCount;
      const nc = Math.max(MIN_VIEW, Math.min(newCount, n));
      const ns = Math.max(0, Math.min(Math.round(anchor - ratio * nc), n - nc));
      setViewCount(nc);
      setViewStart(ns);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewStart, viewCount, n]);

  // ── Zoom helpers ──
  const zoom = useCallback((factor: number) => {
    const nc = Math.max(MIN_VIEW, Math.min(Math.round(viewCount * factor), n));
    const ns = Math.max(0, Math.min(viewStart + Math.floor((viewCount - nc) / 2), n - nc));
    setViewCount(nc); setViewStart(ns);
  }, [viewStart, viewCount, n]);

  const resetView = useCallback(() => {
    const nc = Math.min(n, defaultView);
    setViewCount(nc); setViewStart(Math.max(0, n - nc));
  }, [n, defaultView]);

  // ── Geometry ──
  const chartLeft   = ML;
  const chartTop    = MT;
  const chartRight  = svgWidth - MR;
  const chartBottom = height - MB;
  const chartWidth  = chartRight - chartLeft;
  const volAreaH    = showVolume ? VOL_H : 0;
  const priceHeight = chartBottom - chartTop - volAreaH;
  const volTop      = chartBottom - volAreaH;

  const slotW   = viewCount > 0 ? chartWidth / viewCount : 10;
  const candleW = Math.max(1, Math.min(slotW * 0.76, 24));

  const indexToX = useCallback(
    (i: number) => chartLeft + (i - viewStart) * slotW + (slotW - candleW) / 2,
    [chartLeft, slotW, candleW, viewStart]
  );

  const visEnd = viewStart + viewCount;

  // ── Price range (visible candles + intersecting zones) ──
  const { priceMin, priceMax } = useMemo(() => {
    if (n === 0) return { priceMin: 0, priceMax: 1 };
    const vis = data.candles.slice(viewStart, Math.min(visEnd, n));
    if (vis.length === 0) return { priceMin: 0, priceMax: 1 };
    let hi = Math.max(...vis.map((c) => c.high));
    let lo = Math.min(...vis.map((c) => c.low));
    data.zones.filter(z => z.strength !== "broken" && z.start_index < visEnd && z.end_index >= viewStart).forEach(z => {
      hi = Math.max(hi, z.top); lo = Math.min(lo, z.bottom);
    });
    const pad = (hi - lo) * 0.02;
    return { priceMax: hi + pad, priceMin: lo - pad };
  }, [data, viewStart, visEnd, n]);

  const priceRange = priceMax - priceMin || 1;
  const priceToY   = useCallback(
    (p: number) => chartTop + ((priceMax - p) / priceRange) * priceHeight,
    [chartTop, priceMax, priceRange, priceHeight]
  );

  const maxVol = useMemo(() => {
    const vis = data.candles.slice(viewStart, Math.min(visEnd, n));
    return Math.max(...vis.map((c) => c.volume), 1);
  }, [data, viewStart, visEnd, n]);

  // ── Axes ──
  const yTicks = useMemo(() => {
    const count = 7;
    return Array.from({ length: count }, (_, i) => priceMin + (i / (count - 1)) * priceRange);
  }, [priceMin, priceRange]);

  const xTickIndices = useMemo(() => {
    const step = Math.max(1, Math.floor(viewCount / 8));
    const ticks: number[] = [];
    for (let i = viewStart; i < Math.min(visEnd, n); i += step) ticks.push(i);
    return ticks;
  }, [viewStart, viewCount, visEnd, n]);

  // ── Formatters ──
  const fmtPrice = (p: number) =>
    p >= 1000
      ? `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${p.toFixed(4)}`;

  const fmtDate = useCallback((d: string) => {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const iv = data.interval ?? "1d";
    if (["5m","15m","1h"].includes(iv))
      return dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, [data.interval]);

  const fmtDateFull = useCallback((d: string) => {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const iv = data.interval ?? "1d";
    if (["5m","15m","1h"].includes(iv))
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " " + dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }, [data.interval]);

  // ── Visibility helpers ──
  const inView = (i: number) => i >= viewStart && i < visEnd;

  // ── Mouse events ──
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX   = e.clientX;
    const startVS  = viewStart;
    const sw       = slotW;
    setGrabbing(true);
    setHoverIdx(null);

    const onDocMove = (me: MouseEvent) => {
      const delta = Math.round(-(me.clientX - startX) / sw);
      setViewStart(Math.max(0, Math.min(startVS + delta, n - viewCount)));
    };
    const onDocUp = () => {
      setGrabbing(false);
      document.removeEventListener("mousemove", onDocMove);
      document.removeEventListener("mouseup",   onDocUp);
    };
    document.addEventListener("mousemove", onDocMove);
    document.addEventListener("mouseup",   onDocUp);
  }, [viewStart, slotW, viewCount, n]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (grabbing || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = viewStart + Math.floor((mx - chartLeft) / slotW);
    if (idx >= viewStart && idx < Math.min(visEnd, n)) {
      setHoverIdx(idx);
      setHoverPos({ x: mx, y: my });
    } else {
      setHoverIdx(null);
    }
  }, [grabbing, chartLeft, slotW, viewStart, visEnd, n]);

  const hoverCandle = hoverIdx !== null ? data.candles[hoverIdx] ?? null : null;
  const ttW  = 148;
  const ttH  = 100;
  const ttX  = hoverPos.x + 16 + ttW > svgWidth ? hoverPos.x - ttW - 4 : hoverPos.x + 16;
  const ttY  = Math.max(chartTop + 4, Math.min(hoverPos.y - 30, chartBottom - ttH - 4));

  // ── Scrollbar metrics ──
  const sbLeft  = (viewStart / Math.max(n, 1)) * 100;
  const sbWidth = (viewCount / Math.max(n, 1)) * 100;

  return (
    <div className="space-y-0">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[10px] text-commodity-muted/50 select-none">
          Scroll to zoom · Drag to pan
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => zoom(0.75)} title="Zoom In"
            className="p-1 rounded bg-commodity-panel border border-commodity-border hover:border-amber-500/40 hover:text-amber-400 text-commodity-muted transition-colors">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => zoom(1.33)} title="Zoom Out"
            className="p-1 rounded bg-commodity-panel border border-commodity-border hover:border-amber-500/40 hover:text-amber-400 text-commodity-muted transition-colors">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={resetView} title="Reset View"
            className="p-1 rounded bg-commodity-panel border border-commodity-border hover:border-amber-500/40 hover:text-amber-400 text-commodity-muted transition-colors">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-commodity-muted/40 ml-1 select-none">
            {viewCount} bars
          </span>
        </div>
      </div>

      {/* ── Chart ── */}
      <div ref={containerRef} className="relative w-full select-none" style={{ height }}>
        <svg
          ref={svgRef}
          width={svgWidth}
          height={height}
          style={{ display: "block", cursor: grabbing ? "grabbing" : "crosshair" }}
          className="bg-[#0d1421] rounded-xl border border-[#1e293b]"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Chart background */}
          <rect x={chartLeft} y={chartTop} width={chartWidth} height={priceHeight} fill="#0a1120" rx={2} />

          {/* Y-grid + labels */}
          {yTicks.map((p, i) => {
            const y = priceToY(p);
            return (
              <g key={`yt-${i}`}>
                <line x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke="#1e2d3d" strokeWidth={1} />
                <text x={chartLeft - 5} y={y + 4} fill="#475569" fontSize={10} textAnchor="end" fontFamily="ui-monospace,monospace">
                  {fmtPrice(p)}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {xTickIndices.map((i) => {
            const cx = indexToX(i) + candleW / 2;
            if (cx < chartLeft || cx > chartRight) return null;
            return (
              <text key={`xt-${i}`} x={cx} y={chartBottom + 5} fill="#475569" fontSize={9} textAnchor="end"
                fontFamily="ui-monospace,monospace" transform={`rotate(-30,${cx},${chartBottom + 5})`}>
                {fmtDate(data.candles[i].date)}
              </text>
            );
          })}

          {/* Volume separator */}
          {showVolume && (
            <line x1={chartLeft} y1={volTop} x2={chartRight} y2={volTop} stroke="#1e293b" strokeWidth={1} />
          )}

          {/* Supply / Demand zones */}
          {showSupplyDemand && data.zones
            .filter(z => z.strength !== "broken" && z.start_index < visEnd && z.end_index >= viewStart)
            .map((z, i) => {
              const x1 = Math.max(chartLeft, indexToX(z.start_index));
              const y1 = priceToY(z.top);
              const y2 = priceToY(z.bottom);
              const zw = Math.max(0, chartRight - x1);
              const zh = Math.max(1, y2 - y1);
              const sup = z.type === "supply";
              const fill   = sup
                ? z.strength === "fresh" ? "rgba(239,68,68,0.14)" : "rgba(239,68,68,0.06)"
                : z.strength === "fresh" ? "rgba(16,185,129,0.14)" : "rgba(16,185,129,0.06)";
              const stroke = sup ? "#ef4444" : "#10b981";
              return (
                <g key={`z-${i}`}>
                  <rect x={x1} y={y1} width={zw} height={zh} fill={fill} stroke={stroke}
                    strokeWidth={0.6} strokeDasharray={z.strength === "tested" ? "4,4" : undefined} />
                  <text x={x1 + 4} y={y1 + 11} fill={stroke} fontSize={8} fontWeight="700" opacity={0.85}>
                    {sup ? "SUPPLY" : "DEMAND"} · {z.strength}
                  </text>
                </g>
              );
            })}

          {/* Liquidity pool lines */}
          {showLiquidity && data.liquidity_pools.filter(p => inView(p.index)).map((p, i) => {
            const y = priceToY(p.price);
            if (y < chartTop || y > volTop) return null;
            const color = p.swept ? "#334155" : "#f59e0b";
            return (
              <g key={`lq-${i}`} opacity={p.swept ? 0.3 : 0.7}>
                <line x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke={color} strokeWidth={0.8} strokeDasharray="3,4" />
                <text x={chartRight - 3} y={y - 3} fill={color} fontSize={8} textAnchor="end" fontFamily="ui-monospace,monospace">
                  {p.type} ×{p.num_touches}{p.swept ? " ✓" : ""}
                </text>
              </g>
            );
          })}

          {/* Break lines (MSB/BOS) */}
          {showBreaks && data.breaks.filter(b => inView(b.index)).map((b, i) => {
            const cx  = indexToX(b.index) + candleW / 2;
            const y   = priceToY(b.broken_level);
            const x0  = Math.max(chartLeft, indexToX(Math.max(viewStart, b.index - 25)));
            const col = b.type === "MSB" ? "#f59e0b" : "#94a3b8";
            if (y < chartTop || y > volTop) return null;
            return (
              <g key={`bk-${i}`}>
                <line x1={x0} y1={y} x2={cx} y2={y} stroke={col} strokeWidth={1} strokeDasharray="5,3" />
                <circle cx={cx} cy={y} r={3.5} fill={col} />
                <text x={cx + 8} y={y - 4} fill={col} fontSize={9} fontWeight="800">
                  {b.type} {b.direction === "bullish" ? "↑" : "↓"}
                </text>
              </g>
            );
          })}

          {/* Structure labels */}
          {showStructureLabels && data.structure.filter(s => inView(s.index)).map((s, i) => {
            const cx     = indexToX(s.index) + candleW / 2;
            const y      = priceToY(s.price);
            const isHi   = s.label === "HH" || s.label === "LH";
            const col    = s.trend === "bullish" ? "#34d399" : "#f87171";
            if (y < chartTop || y > volTop) return null;
            return (
              <text key={`sl-${i}`} x={cx} y={isHi ? y - 7 : y + 14}
                fill={col} fontSize={9} textAnchor="middle" fontWeight="800">
                {s.label}
              </text>
            );
          })}

          {/* Swing point dots */}
          {showSwingPoints && data.swing_points.filter(sp => inView(sp.index)).map((sp, i) => {
            const cx  = indexToX(sp.index) + candleW / 2;
            const y   = priceToY(sp.price);
            const col = sp.type === "high" ? "#f87171" : "#34d399";
            if (y < chartTop || y > volTop) return null;
            return <circle key={`sw-${i}`} cx={cx} cy={y} r={2.5} fill={col} opacity={0.8} />;
          })}

          {/* Candles */}
          {data.candles.slice(viewStart, Math.min(visEnd, n)).map((c, vi) => {
            const i       = viewStart + vi;
            const x       = indexToX(i);
            const cx      = x + candleW / 2;
            const bull    = c.close >= c.open;
            const col     = bull ? "#26a69a" : "#ef5350";
            const bodyTop = priceToY(Math.max(c.open, c.close));
            const bodyBot = priceToY(Math.min(c.open, c.close));
            const bodyH   = Math.max(1, bodyBot - bodyTop);
            const wickW   = Math.max(1, candleW * 0.14);
            return (
              <g key={`cd-${i}`}>
                <line x1={cx} y1={priceToY(c.high)} x2={cx} y2={priceToY(c.low)}
                  stroke={col} strokeWidth={wickW} />
                <rect x={x} y={bodyTop} width={candleW} height={bodyH}
                  fill={bull ? col : col} opacity={0.92} rx={candleW > 4 ? 0.5 : 0} />
              </g>
            );
          })}

          {/* Volume bars */}
          {showVolume && data.candles.slice(viewStart, Math.min(visEnd, n)).map((c, vi) => {
            const i    = viewStart + vi;
            const x    = indexToX(i);
            const bull = c.close >= c.open;
            const bh   = Math.max(1, (c.volume / maxVol) * (volAreaH - 6));
            return (
              <rect key={`vl-${i}`} x={x} y={volTop + volAreaH - bh} width={candleW} height={bh}
                fill={bull ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)"} />
            );
          })}

          {/* Crosshair */}
          {hoverIdx !== null && !grabbing && (
            <>
              <line x1={hoverPos.x} y1={chartTop} x2={hoverPos.x} y2={chartBottom}
                stroke="#334155" strokeWidth={1} strokeDasharray="3,3" />
              <line x1={chartLeft} y1={hoverPos.y} x2={chartRight} y2={hoverPos.y}
                stroke="#334155" strokeWidth={1} strokeDasharray="3,3" />
              {hoverPos.y >= chartTop && hoverPos.y <= volTop && (() => {
                const price = priceMax - ((hoverPos.y - chartTop) / priceHeight) * priceRange;
                return (
                  <g>
                    <rect x={1} y={hoverPos.y - 9} width={chartLeft - 3} height={17} fill="#1e293b" rx={2} />
                    <text x={chartLeft - 5} y={hoverPos.y + 4} fill="#f59e0b" fontSize={9} textAnchor="end" fontFamily="ui-monospace,monospace">
                      {fmtPrice(price)}
                    </text>
                  </g>
                );
              })()}
            </>
          )}

          {/* Tooltip */}
          {hoverIdx !== null && hoverCandle && !grabbing && (
            <g>
              <rect x={ttX} y={ttY} width={ttW} height={ttH} fill="#0f172a" stroke="#1e293b" strokeWidth={1} rx={5} />
              <rect x={ttX} y={ttY} width={ttW} height={16} fill="#0d1f35" rx={5} />
              <rect x={ttX} y={ttY + 11} width={ttW} height={5} fill="#0d1f35" />
              <text x={ttX + 7} y={ttY + 12} fill="#94a3b8" fontSize={9} fontFamily="ui-monospace,monospace">
                {fmtDateFull(hoverCandle.date)}
              </text>
              {[
                ["O", fmtPrice(hoverCandle.open), "#e2e8f0"],
                ["H", fmtPrice(hoverCandle.high), "#34d399"],
                ["L", fmtPrice(hoverCandle.low), "#f87171"],
                ["C", fmtPrice(hoverCandle.close), hoverCandle.close >= hoverCandle.open ? "#26a69a" : "#ef5350"],
              ].map(([label, val, color], row) => (
                <g key={label as string}>
                  <text x={ttX + 7} y={ttY + 29 + row * 16} fill="#64748b" fontSize={9} fontFamily="ui-monospace,monospace">{label}:</text>
                  <text x={ttX + 26} y={ttY + 29 + row * 16} fill={color as string} fontSize={9} fontFamily="ui-monospace,monospace" fontWeight="600">{val as string}</text>
                </g>
              ))}
              <text x={ttX + 7} y={ttY + 93} fill="#475569" fontSize={8} fontFamily="ui-monospace,monospace">
                Vol {hoverCandle.volume >= 1e6 ? `${(hoverCandle.volume / 1e6).toFixed(2)}M` : hoverCandle.volume.toLocaleString()}
              </text>
            </g>
          )}

          {/* Chart border */}
          <rect x={chartLeft} y={chartTop} width={chartWidth} height={priceHeight}
            fill="none" stroke="#1e293b" strokeWidth={1} />
        </svg>

        {/* Mini scrollbar */}
        {n > viewCount && (
          <div className="absolute bottom-0 mx-0 w-full px-[74px] pb-1">
            <div className="h-[3px] bg-[#1e293b] rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500/50 rounded-full"
                style={{ marginLeft: `${sbLeft}%`, width: `${sbWidth}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
