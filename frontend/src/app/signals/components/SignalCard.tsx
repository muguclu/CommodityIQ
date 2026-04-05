"use client";

import { useEffect, useRef, useState } from "react";
import type { Signal } from "../types";
import ConfidenceMeter from "./ConfidenceMeter";
import IndicatorRow from "./IndicatorRow";
import PriceLevels from "./PriceLevels";
import SignalBadge from "./SignalBadge";

interface Props {
  signal: Signal;
}

function useCountdown(validUntil: string): number {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(validUntil).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.floor((new Date(validUntil).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [validUntil]);

  return remaining;
}

function fmtCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const GLOW: Record<string, string> = {
  BUY:  "hover:shadow-emerald-500/15 hover:border-emerald-500/25",
  SELL: "hover:shadow-red-500/15     hover:border-red-500/25",
  WAIT: "hover:shadow-slate-500/10   hover:border-slate-500/20",
};

export default function SignalCard({ signal }: Props) {
  const remaining    = useCountdown(signal.valid_until);
  const totalSecs    = 15 * 60; // 15 min validity
  const pctLeft      = remaining / totalSecs;

  // Flash animation on signal_type change
  const prevTypeRef  = useRef(signal.signal_type);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (prevTypeRef.current !== signal.signal_type) {
      prevTypeRef.current = signal.signal_type;
      setFlashKey((k) => k + 1);
    }
  }, [signal.signal_type]);

  const expired = remaining === 0;

  return (
    <div
      key={flashKey}
      className={`
        relative flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60
        p-4 backdrop-blur-sm shadow-lg transition-all duration-300 overflow-hidden
        ${expired ? "opacity-40 grayscale" : ""}
        ${GLOW[signal.signal_type]}
        ${flashKey > 0 ? "animate-signal-flash" : "animate-fade-in"}
        hover:shadow-xl
      `}
    >
      {/* Countdown progress bar at the top */}
      <div className="absolute top-0 left-0 h-0.5 w-full bg-slate-800">
        <div
          className={`h-full transition-all duration-1000 ${
            pctLeft > 0.5 ? "bg-emerald-500/60" :
            pctLeft > 0.2 ? "bg-amber-500/60"   :
                             "bg-red-500/60"
          }`}
          style={{ width: `${pctLeft * 100}%` }}
        />
      </div>

      {/* Header: symbol + badge */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div>
          <span className="font-mono text-sm font-bold text-slate-100 tracking-wider">
            {signal.symbol}
          </span>
          <span className="ml-2 text-[10px] text-slate-600 font-mono">
            {signal.timeframe}
          </span>
        </div>
        <SignalBadge type={signal.signal_type} />
      </div>

      {/* Confidence */}
      <ConfidenceMeter value={signal.confidence} />

      {/* Price levels */}
      <PriceLevels
        signalType={signal.signal_type}
        entryPrice={signal.entry_price}
        takeProfit={signal.take_profit}
        stopLoss={signal.stop_loss}
        rr={signal.risk_reward_ratio}
      />

      {/* TFT + SMC */}
      <div className="border-t border-slate-800 pt-2">
        <IndicatorRow
          tftDirection={signal.tft_direction}
          smcBias={signal.smc_bias}
        />
      </div>

      {/* Footer: countdown */}
      <div className="flex items-center justify-between text-[10px] text-slate-600 font-mono">
        <span>
          {expired
            ? "Expired"
            : `Expires in ${fmtCountdown(remaining)}`}
        </span>
        {!!signal.metadata?.tft_available && (
          <span className="text-amber-600" title="TFT forecast available">TFT ✓</span>
        )}
      </div>
    </div>
  );
}
