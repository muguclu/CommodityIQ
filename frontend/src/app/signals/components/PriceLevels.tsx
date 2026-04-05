import type { SignalType } from "../types";

function fmt(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

interface Props {
  signalType:  SignalType;
  entryPrice:  number;
  takeProfit:  number;
  stopLoss:    number;
  rr:          number;
}

export default function PriceLevels({ signalType, entryPrice, takeProfit, stopLoss, rr }: Props) {
  if (signalType === "WAIT") {
    return (
      <div className="flex items-center justify-center h-20 text-slate-600 text-sm italic">
        No trade setup
      </div>
    );
  }

  return (
    <div className="space-y-1.5 text-xs font-mono">
      <Row label="Entry" value={fmt(entryPrice)} color="text-slate-300" />
      <Row label="TP"    value={fmt(takeProfit)}  color="text-emerald-400" />
      <Row label="SL"    value={fmt(stopLoss)}    color="text-red-400" />
      <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
        <span className="text-slate-500">R:R</span>
        <span className={`font-semibold ${rr >= 1.5 ? "text-emerald-400" : "text-amber-400"}`}>
          1:{rr.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500 w-8 shrink-0">{label}</span>
      <span className={`${color} tabular-nums`}>{value}</span>
    </div>
  );
}
