interface Props {
  value: number; // 0.0 – 1.0
}

function getColor(v: number): string {
  if (v >= 0.7) return "#10b981"; // emerald-500
  if (v >= 0.4) return "#f59e0b"; // amber-500
  return "#ef4444";               // red-500
}

export default function ConfidenceMeter({ value }: Props) {
  const pct    = Math.round(value * 100);
  const color  = getColor(value);
  const width  = `${pct}%`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Confidence</span>
        <span className="font-mono text-xs font-semibold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width, background: `linear-gradient(90deg, #ef4444 0%, #f59e0b 50%, #10b981 100%)`, clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Confidence: ${pct}%`}
        />
      </div>
    </div>
  );
}
