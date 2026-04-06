"use client";

import { useState } from "react";
import { History, TrendingUp, Award, BarChart2 } from "lucide-react";
import { useSignalHistory, useSignalStats, type HistoryFilters } from "../hooks/useSignalHistory";
import type { Outcome, SignalHistoryRecord, SignalType, SymbolStats } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function fmtPrice(v?: number): string {
  if (v == null) return "—";
  return v >= 1000 ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                   : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

const SIGNAL_COLOR: Record<SignalType, string> = {
  BUY:  "text-emerald-400",
  SELL: "text-red-400",
  WAIT: "text-slate-400",
};

const OUTCOME_CONFIG: Record<Outcome, { label: string; classes: string }> = {
  tp_hit:  { label: "TP Hit",   classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  sl_hit:  { label: "SL Hit",   classes: "bg-red-500/15    text-red-400    border-red-500/25"    },
  expired: { label: "Expired",  classes: "bg-slate-500/15  text-slate-400  border-slate-500/25"  },
  pending: { label: "Pending",  classes: "bg-amber-500/15  text-amber-400  border-amber-500/25"  },
};

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const { label, classes } = OUTCOME_CONFIG[outcome] ?? OUTCOME_CONFIG.pending;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-lg font-bold font-mono text-slate-100">{value}</p>
        {sub && <p className="text-xs text-slate-600">{sub}</p>}
      </div>
    </div>
  );
}

function SummaryCards({ stats }: { stats: SymbolStats[] }) {
  const total   = stats.reduce((s, x) => s + x.total, 0);
  const wins    = stats.reduce((s, x) => s + x.wins, 0);
  const losses  = stats.reduce((s, x) => s + x.losses, 0);
  const closed  = wins + losses;
  const winRate = closed > 0 ? Math.round((wins / closed) * 100) : 0;
  const avgRR   = stats.length
    ? (stats.reduce((s, x) => s + x.avg_rr, 0) / stats.length).toFixed(2)
    : "0.00";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard icon={<BarChart2 className="w-4 h-4 text-slate-400" />} label="Total Signals" value={String(total)} />
      <StatCard icon={<Award className="w-4 h-4 text-emerald-400" />}  label="Win Rate"     value={`${winRate}%`} sub={`${wins}W / ${losses}L`} />
      <StatCard icon={<TrendingUp className="w-4 h-4 text-amber-400" />} label="Avg R:R"    value={`1:${avgRR}`} />
      <StatCard icon={<History className="w-4 h-4 text-slate-400" />}  label="Symbols"      value={String(stats.length)} />
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

const SYMBOLS = ["", "XAUUSD", "XAGUSD", "USOIL", "UKOIL", "NATGAS"];
const TYPES   = ["", "BUY", "SELL", "WAIT"];

interface FilterBarProps {
  filters:    HistoryFilters;
  onChange:   (f: Partial<HistoryFilters>) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={filters.symbol ?? ""}
        onChange={(v) => onChange({ symbol: v || undefined, offset: 0 })}
        options={SYMBOLS.map(s => ({ value: s, label: s || "All Symbols" }))}
      />
      <Select
        value={filters.signal_type ?? ""}
        onChange={(v) => onChange({ signal_type: v || undefined, offset: 0 })}
        options={TYPES.map(t => ({ value: t, label: t || "All Types" }))}
      />
      <input
        type="date"
        value={filters.from_date ?? ""}
        onChange={(e) => onChange({ from_date: e.target.value || undefined, offset: 0 })}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50"
        placeholder="From"
      />
      <input
        type="date"
        value={filters.to_date ?? ""}
        onChange={(e) => onChange({ to_date: e.target.value || undefined, offset: 0 })}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50"
        placeholder="To"
      />
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/50"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── History table ─────────────────────────────────────────────────────────────

function HistoryRow({ r }: { r: SignalHistoryRecord }) {
  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
      <td className="px-3 py-2.5 text-xs text-slate-500 font-mono whitespace-nowrap">
        {fmtTime(r.generated_at)}
      </td>
      <td className="px-3 py-2.5 text-xs font-mono font-bold text-slate-200">
        {r.symbol}
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-xs font-bold ${SIGNAL_COLOR[r.signal_type]}`}>
          {r.signal_type}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
        {Math.round(r.confidence * 100)}%
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-400 hidden sm:table-cell">
        {fmtPrice(r.entry_price)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-emerald-400 hidden md:table-cell">
        {fmtPrice(r.take_profit)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-red-400 hidden md:table-cell">
        {fmtPrice(r.stop_loss)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-400 hidden lg:table-cell">
        {r.risk_reward_ratio != null ? `1:${r.risk_reward_ratio.toFixed(1)}` : "—"}
      </td>
      <td className="px-3 py-2.5">
        <OutcomeBadge outcome={r.outcome} />
      </td>
    </tr>
  );
}

function Pagination({ offset, limit, total, onPage }: {
  offset: number; limit: number; total: number; onPage: (o: number) => void;
}) {
  const page  = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex items-center justify-between px-1 pt-3 text-xs text-slate-500">
      <span>
        {total > 0
          ? `Showing ${offset + 1}–${Math.min(offset + limit, total)} of ${total}`
          : "No results"}
      </span>
      <div className="flex gap-1.5">
        <button
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
          className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ‹ Prev
        </button>
        <span className="px-2 py-1">
          {page} / {pages}
        </span>
        <button
          disabled={offset + limit >= total}
          onClick={() => onPage(offset + limit)}
          className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const LIMIT = 50;

export default function SignalHistoryPage() {
  const [filters, setFilters] = useState<HistoryFilters>({ limit: LIMIT, offset: 0 });

  const { records, total, loading, error } = useSignalHistory(filters);
  const { stats } = useSignalStats();

  function patchFilters(patch: Partial<HistoryFilters>) {
    setFilters(prev => ({ ...prev, ...patch }));
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800 border border-slate-700">
          <History className="w-4 h-4 text-slate-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-100 leading-tight">Signal History</h1>
          <p className="text-xs text-slate-500">All generated signals, outcomes, and performance stats</p>
        </div>
      </div>

      {/* Summary */}
      {stats.length > 0 && <SummaryCards stats={stats} />}

      {/* Filters */}
      <FilterBar filters={filters} onChange={patchFilters} />

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80">
                {["Time", "Symbol", "Type", "Conf", "Entry", "TP", "SL", "R:R", "Outcome"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-800/60 animate-pulse">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-3 w-full rounded bg-slate-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-600 text-sm">
                    No signals found. Adjust the filters or wait for the collector to send data.
                  </td>
                </tr>
              ) : (
                records.map((r, i) => <HistoryRow key={r.id ?? i} r={r} />)
              )}
            </tbody>
          </table>
        </div>

        {!loading && total > 0 && (
          <div className="px-3 pb-3">
            <Pagination
              offset={filters.offset}
              limit={LIMIT}
              total={total}
              onPage={(o) => patchFilters({ offset: o })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
