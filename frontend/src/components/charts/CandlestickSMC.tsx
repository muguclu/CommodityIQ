"use client";

import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
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

const ML = 70;   // margin left
const MR = 20;   // margin right
const MT = 20;   // margin top
const MB = 80;   // margin bottom
const VOL_H = 50; // volume sub-chart height

export default function CandlestickSMC({
  data,
  height = 500,
  showSwingPoints = true,
  showStructureLabels = true,
  showBreaks = true,
  showSupplyDemand = true,
  showLiquidity = true,
  showVolume = true,
}: CandlestickSMCProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgWidth, setSvgWidth] = useState(800);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setSvgWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    setSvgWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Derived geometry
  const chartLeft   = ML;
  const chartTop    = MT;
  const chartRight  = svgWidth - MR;
  const chartBottom = height - MB;
  const chartWidth  = chartRight - chartLeft;
  const priceHeight = chartBottom - chartTop - VOL_H;
  const volTop      = chartBottom - VOL_H;

  const n       = data.candles.length;
  const slotW   = n > 0 ? chartWidth / n : 10;
  const candleW = Math.max(2, slotW * 0.7);

  const indexToX = useCallback(
    (i: number) => chartLeft + i * slotW + (slotW - candleW) / 2,
    [chartLeft, slotW, candleW]
  );

  // Price range (include zone boundaries)
  const { priceMin, priceMax } = useMemo(() => {
    if (n === 0) return { priceMin: 0, priceMax: 1 };
    const hs = data.candles.map((c) => c.high);
    const ls = data.candles.map((c) => c.low);
    const zt = data.zones.map((z) => z.top);
    const zb = data.zones.map((z) => z.bottom);
    const raw_max = Math.max(...hs, ...zt);
    const raw_min = Math.min(...ls, ...zb);
    return { priceMax: raw_max * 1.002, priceMin: raw_min * 0.998 };
  }, [data, n]);

  const priceRange = priceMax - priceMin;

  const priceToY = useCallback(
    (p: number) => chartTop + ((priceMax - p) / priceRange) * priceHeight,
    [chartTop, priceMax, priceRange, priceHeight]
  );

  const maxVol = useMemo(
    () => Math.max(...data.candles.map((c) => c.volume), 1),
    [data]
  );

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, i) => priceMin + (i / (count - 1)) * priceRange);
  }, [priceMin, priceRange]);

  // X-axis ticks (~8 labels)
  const xTickIndices = useMemo(() => {
    const step = Math.max(1, Math.floor(n / 8));
    const ticks: number[] = [];
    for (let i = 0; i < n; i += step) ticks.push(i);
    return ticks;
  }, [n]);

  const fmtPrice = (p: number) =>
    p >= 1000
      ? `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${p.toFixed(2)}`;

  const fmtDate = useCallback(
    (d: string) => {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      const interval = data.interval ?? "1d";
      if (interval === "5m" || interval === "15m" || interval === "1h")
        return dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    },
    [data.interval]
  );

  const fmtTooltipDate = useCallback(
    (d: string) => {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      const interval = data.interval ?? "1d";
      if (interval === "5m" || interval === "15m" || interval === "1h")
        return (
          dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
          " " +
          dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
        );
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    },
    [data.interval]
  );

  // Mouse events
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const idx = Math.floor((mx - chartLeft) / slotW);
      if (idx >= 0 && idx < n) {
        setHoverIdx(idx);
        setHoverPos({ x: mx, y: my });
      } else {
        setHoverIdx(null);
      }
    },
    [chartLeft, slotW, n]
  );

  const hoverCandle = hoverIdx !== null ? data.candles[hoverIdx] : null;

  // Tooltip position — clamp so it stays inside chart
  const ttX = hoverPos.x + 14 + 132 > svgWidth ? hoverPos.x - 146 : hoverPos.x + 14;
  const ttY = Math.max(chartTop + 4, Math.min(hoverPos.y - 44, chartBottom - 88));

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg
        ref={svgRef}
        width={svgWidth}
        height={height}
        style={{ willChange: "transform", display: "block" }}
        className="bg-[#0f172a] rounded-xl"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* ── Background ── */}
        <rect x={chartLeft} y={chartTop} width={chartWidth} height={priceHeight} fill="#0a1628" rx={2} />

        {/* ── Y-axis grid + labels ── */}
        {yTicks.map((p, i) => {
          const y = priceToY(p);
          return (
            <g key={`ytick-${i}`}>
              <line x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke="#1e293b" strokeWidth={1} />
              <text
                x={chartLeft - 6} y={y + 4}
                fill="#64748b" fontSize={10} textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {fmtPrice(p)}
              </text>
            </g>
          );
        })}

        {/* ── X-axis labels ── */}
        {xTickIndices.map((i) => {
          const cx = indexToX(i) + candleW / 2;
          const d = fmtDate(data.candles[i].date);
          return (
            <text
              key={`xtick-${i}`}
              x={cx} y={chartBottom + 6}
              fill="#64748b" fontSize={9} textAnchor="end"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              transform={`rotate(-30, ${cx}, ${chartBottom + 6})`}
            >
              {d}
            </text>
          );
        })}

        {/* ── Volume divider ── */}
        <line x1={chartLeft} y1={volTop} x2={chartRight} y2={volTop} stroke="#1e293b" strokeWidth={1} />

        {/* ── Supply / Demand Zones (drawn first so candles appear on top) ── */}
        {showSupplyDemand &&
          data.zones
            .filter((z) => z.strength !== "broken")
            .map((z, i) => {
              const x1 = Math.max(chartLeft, indexToX(z.start_index));
              const y1 = priceToY(z.top);
              const y2 = priceToY(z.bottom);
              const w  = Math.max(0, chartRight - x1);
              const h  = Math.max(1, y2 - y1);
              const isSupply = z.type === "supply";
              const fill = isSupply
                ? z.strength === "fresh" ? "rgba(239,68,68,0.13)" : "rgba(239,68,68,0.06)"
                : z.strength === "fresh" ? "rgba(16,185,129,0.13)" : "rgba(16,185,129,0.06)";
              const stroke = isSupply ? "#ef4444" : "#10b981";
              return (
                <g key={`zone-${i}`}>
                  <rect
                    x={x1} y={y1} width={w} height={h}
                    fill={fill} stroke={stroke} strokeWidth={0.5}
                    strokeDasharray={z.strength === "tested" ? "4,4" : undefined}
                  />
                  <text x={x1 + 4} y={y1 + 11} fill={stroke} fontSize={9} fontWeight="600">
                    {isSupply ? "SUPPLY" : "DEMAND"} ({z.strength})
                  </text>
                </g>
              );
            })}

        {/* ── Liquidity Pool Lines ── */}
        {showLiquidity &&
          data.liquidity_pools.map((p, i) => {
            const y = priceToY(p.price);
            if (y < chartTop || y > chartBottom) return null;
            const color  = p.swept ? "#475569" : "#f59e0b";
            const opaque = p.swept ? 0.3 : 0.65;
            return (
              <g key={`liq-${i}`} opacity={opaque}>
                <line
                  x1={chartLeft} y1={y} x2={chartRight} y2={y}
                  stroke={color} strokeWidth={1} strokeDasharray="2,3"
                />
                <text
                  x={chartRight - 4} y={y - 3}
                  fill={color} fontSize={8} textAnchor="end"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {p.type} {p.num_touches}× {p.swept ? "✓ swept" : "$ unswept"}
                </text>
              </g>
            );
          })}

        {/* ── Break Lines (BOS / MSB) ── */}
        {showBreaks &&
          data.breaks.map((b, i) => {
            const cx   = indexToX(b.index) + candleW / 2;
            const y    = priceToY(b.broken_level);
            const x0   = indexToX(Math.max(0, b.index - 20));
            const color = b.type === "MSB" ? "#f59e0b" : "#64748b";
            if (y < chartTop || y > chartBottom) return null;
            return (
              <g key={`brk-${i}`}>
                <line x1={x0} y1={y} x2={cx} y2={y} stroke={color} strokeWidth={1} strokeDasharray="4,2" />
                <circle cx={cx} cy={y} r={3.5} fill={color} />
                <text x={cx + 7} y={y - 5} fill={color} fontSize={9} fontWeight="700">
                  {b.type} {b.direction === "bullish" ? "↑" : "↓"}
                </text>
              </g>
            );
          })}

        {/* ── Structure Labels (HH/HL/LH/LL) ── */}
        {showStructureLabels &&
          data.structure.map((s, i) => {
            const cx      = indexToX(s.index) + candleW / 2;
            const y       = priceToY(s.price);
            const isHigh  = s.label === "HH" || s.label === "LH";
            const color   = s.trend === "bullish" ? "#10b981" : "#ef4444";
            if (y < chartTop || y > chartBottom) return null;
            return (
              <text
                key={`struct-${i}`}
                x={cx} y={isHigh ? y - 8 : y + 15}
                fill={color} fontSize={9} textAnchor="middle" fontWeight="700"
              >
                {s.label}
              </text>
            );
          })}

        {/* ── Swing Point Dots ── */}
        {showSwingPoints &&
          data.swing_points.map((sp, i) => {
            const cx    = indexToX(sp.index) + candleW / 2;
            const y     = priceToY(sp.price);
            const color = sp.type === "high" ? "#ef4444" : "#10b981";
            if (y < chartTop || y > chartBottom) return null;
            return <circle key={`sp-${i}`} cx={cx} cy={y} r={2} fill={color} opacity={0.6} />;
          })}

        {/* ── Candles ── */}
        {data.candles.map((c, i) => {
          const x       = indexToX(i);
          const cx      = x + candleW / 2;
          const isGreen = c.close >= c.open;
          const color   = isGreen ? "#10b981" : "#ef4444";
          const bodyTop = priceToY(Math.max(c.open, c.close));
          const bodyBot = priceToY(Math.min(c.open, c.close));
          const bodyH   = Math.max(1, bodyBot - bodyTop);
          return (
            <g key={`c-${i}`}>
              <line
                x1={cx} y1={priceToY(c.high)}
                x2={cx} y2={priceToY(c.low)}
                stroke={color} strokeWidth={1}
              />
              <rect x={x} y={bodyTop} width={candleW} height={bodyH} fill={color} rx={0.5} />
            </g>
          );
        })}

        {/* ── Volume Bars ── */}
        {showVolume &&
          data.candles.map((c, i) => {
            const x       = indexToX(i);
            const isGreen = c.close >= c.open;
            const bh      = (c.volume / maxVol) * (VOL_H - 4);
            return (
              <rect
                key={`vol-${i}`}
                x={x} y={volTop + VOL_H - bh}
                width={candleW} height={bh}
                fill={isGreen ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}
              />
            );
          })}

        {/* ── Crosshair ── */}
        {hoverIdx !== null && (
          <>
            <line
              x1={hoverPos.x} y1={chartTop}
              x2={hoverPos.x} y2={chartBottom}
              stroke="#475569" strokeWidth={0.5} strokeDasharray="3,3"
            />
            <line
              x1={chartLeft} y1={hoverPos.y}
              x2={chartRight} y2={hoverPos.y}
              stroke="#475569" strokeWidth={0.5} strokeDasharray="3,3"
            />
            {hoverPos.y >= chartTop && hoverPos.y <= chartBottom && (() => {
              const price = priceMax - ((hoverPos.y - chartTop) / priceHeight) * priceRange;
              return (
                <g>
                  <rect x={0} y={hoverPos.y - 9} width={chartLeft - 2} height={17} fill="#1e293b" rx={2} />
                  <text
                    x={chartLeft - 5} y={hoverPos.y + 4}
                    fill="#f59e0b" fontSize={9} textAnchor="end"
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  >
                    {fmtPrice(price)}
                  </text>
                </g>
              );
            })()}
          </>
        )}

        {/* ── Tooltip Box ── */}
        {hoverIdx !== null && hoverCandle && (
          <g>
            <rect x={ttX} y={ttY} width={132} height={84} fill="#0f172a" stroke="#f59e0b" strokeWidth={0.8} rx={4} />
            <text
              x={ttX + 7} y={ttY + 14}
              fill="#94a3b8" fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              {fmtTooltipDate(hoverCandle.date)}
            </text>
            <text
              x={ttX + 7} y={ttY + 29}
              fill="#e2e8f0" fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              O: {fmtPrice(hoverCandle.open)}
            </text>
            <text
              x={ttX + 70} y={ttY + 29}
              fill="#e2e8f0" fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              H: {fmtPrice(hoverCandle.high)}
            </text>
            <text
              x={ttX + 7} y={ttY + 43}
              fill="#e2e8f0" fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              L: {fmtPrice(hoverCandle.low)}
            </text>
            <text
              x={ttX + 70} y={ttY + 43}
              fill={hoverCandle.close >= hoverCandle.open ? "#10b981" : "#ef4444"}
              fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              C: {fmtPrice(hoverCandle.close)}
            </text>
            <text
              x={ttX + 7} y={ttY + 57}
              fill="#64748b" fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, monospace"
            >
              Vol: {hoverCandle.volume.toLocaleString()}
            </text>
          </g>
        )}

        {/* ── Border ── */}
        <rect
          x={chartLeft} y={chartTop}
          width={chartWidth} height={priceHeight}
          fill="none" stroke="#1e293b" strokeWidth={1}
        />
      </svg>
    </div>
  );
}
