import type { SignalType } from "../types";

const CONFIG: Record<SignalType, { label: string; icon: string; classes: string }> = {
  BUY:  { label: "BUY",  icon: "▲", classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-emerald-500/10" },
  SELL: { label: "SELL", icon: "▼", classes: "bg-red-500/15    text-red-400    border-red-500/30    shadow-red-500/10"    },
  WAIT: { label: "WAIT", icon: "●", classes: "bg-slate-500/15  text-slate-400  border-slate-500/30  shadow-none"          },
};

export default function SignalBadge({ type }: { type: SignalType }) {
  const { label, icon, classes } = CONFIG[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold tracking-wide shadow-sm ${classes}`}
      role="status"
      aria-label={`Signal: ${label}`}
    >
      <span aria-hidden="true" className="text-xs">{icon}</span>
      {label}
    </span>
  );
}
