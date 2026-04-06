"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { History, Radio } from "lucide-react";
import { useSignals } from "./hooks/useSignals";
import ConnectionStatus from "./components/ConnectionStatus";
import NotificationToggle, { sendSignalNotification, useNotificationPermission } from "./components/NotificationToggle";
import SignalCard from "./components/SignalCard";
import SignalCardSkeleton from "./components/SignalCardSkeleton";
import type { Signal } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function avgConfidence(signals: Signal[]): number {
  if (!signals.length) return 0;
  return signals.reduce((s, x) => s + x.confidence, 0) / signals.length;
}

function getMarketSession(): string {
  const h = new Date().getUTCHours();
  if (h >= 22 || h < 7)  return "Asian Session";
  if (h >= 7  && h < 12) return "London Session";
  if (h >= 12 && h < 16) return "London / New York Overlap";
  if (h >= 16 && h < 22) return "New York Session";
  return "Off-hours";
}

function ConfidenceBar({ pct }: { pct: number }) {
  const filled = Math.round(pct / 10);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-3 rounded-sm transition-all duration-500 ${
              i < filled
                ? i < 4 ? "bg-red-500" : i < 7 ? "bg-amber-500" : "bg-emerald-500"
                : "bg-slate-800"
            }`}
          />
        ))}
      </div>
      <span className="font-mono text-xs text-slate-400">{pct}% avg</span>
    </div>
  );
}

function StatsBar({ signals }: { signals: Signal[] }) {
  const buys  = signals.filter(s => s.signal_type === "BUY").length;
  const sells = signals.filter(s => s.signal_type === "SELL").length;
  const waits = signals.filter(s => s.signal_type === "WAIT").length;
  const avg   = Math.round(avgConfidence(signals) * 100);
  const session = getMarketSession();

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">Signal Strength</span>
        <ConfidenceBar pct={avg} />
      </div>
      <div className="h-4 w-px bg-slate-800 hidden sm:block" />
      <div className="flex items-center gap-3 font-mono">
        <span className="text-emerald-400">{buys} BUY</span>
        <span className="text-red-400">{sells} SELL</span>
        <span className="text-slate-500">{waits} WAIT</span>
      </div>
      <div className="h-4 w-px bg-slate-800 hidden sm:block" />
      <span className="text-slate-500">{session}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const { signals, loading, error, lastUpdated, isStale, refetch } = useSignals();
  const [notifEnabled, setNotifEnabled] = useState(false);
  const { register }                    = useNotificationPermission();
  const prevSymbolsRef = useRef<Set<string>>(new Set());

  // Register service worker on mount
  useEffect(() => { register(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire notification when a new actionable signal appears
  useEffect(() => {
    if (!notifEnabled || loading) return;
    signals.forEach((s) => {
      const key = `${s.symbol}:${s.signal_type}:${s.generated_at}`;
      if (prevSymbolsRef.current.has(key)) return;
      prevSymbolsRef.current.add(key);
      if (s.signal_type !== "WAIT" && s.confidence >= 0.7) {
        sendSignalNotification(s.symbol, s.signal_type, s.confidence, s.entry_price);
      }
    });
  }, [signals, notifEnabled, loading]);

  const hasSignals = signals.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-fade-in">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Radio className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100 leading-tight">Live Signals</h1>
            <p className="text-xs text-slate-500">
              TFT + SMC confluence · refreshes every 30s
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <NotificationToggle enabled={notifEnabled} onChange={setNotifEnabled} />
          <Link
            href="/signals/history"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <History className="w-3 h-3" />
            History
          </Link>
          <ConnectionStatus
            loading={loading}
            error={error}
            lastUpdated={lastUpdated}
            isStale={isStale}
            onRefresh={refetch}
          />
        </div>
      </div>

      {/* ── Stale warning ── */}
      {isStale && !error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-400">
          <span>⚠</span>
          <span>Data is over 10 minutes old. Check collector connection.</span>
        </div>
      )}

      {/* ── Error state ── */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 py-16 text-center">
          <span className="text-3xl">📡</span>
          <p className="text-red-400 font-medium">Signal service unavailable</p>
          <p className="text-slate-500 text-sm max-w-sm">{error}</p>
          <button
            onClick={refetch}
            className="mt-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading skeletons ── */}
      {loading && !hasSignals && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SignalCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* ── Signal grid ── */}
      {!loading && !error && hasSignals && (
        <>
          <StatsBar signals={signals} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {signals.map((s) => (
              <SignalCard key={s.symbol} signal={s} />
            ))}
          </div>
        </>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && !hasSignals && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 py-20 text-center">
          <span className="text-4xl">⏳</span>
          <p className="text-slate-400 font-medium">Waiting for signals</p>
          <p className="text-slate-600 text-sm max-w-sm">
            No active signals yet. Make sure the MT5 collector is running and
            posting data to <span className="font-mono text-slate-500">/api/signals/feed</span>.
          </p>
        </div>
      )}
    </div>
  );
}
