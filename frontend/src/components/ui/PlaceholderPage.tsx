import { LucideIcon, Clock, CheckCircle2 } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  icon: LucideIcon;
  description: string;
  phase: number;
  features: string[];
  color: string;
  borderColor: string;
  bgColor: string;
}

export default function PlaceholderPage({
  title,
  icon: Icon,
  description,
  phase,
  features,
  color,
  borderColor,
  bgColor,
}: PlaceholderPageProps) {
  return (
    <div className="p-6 md:p-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <span className="font-mono text-xs text-slate-600">CommodityIQ</span>
        <span className="text-slate-700">/</span>
        <span className={`font-mono text-xs ${color}`}>{title}</span>
      </div>

      {/* Header card */}
      <div className={`glass-card rounded-xl border ${borderColor} p-6 mb-6`}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div
            className={`flex items-center justify-center w-12 h-12 rounded-xl ${bgColor} border ${borderColor} shrink-0`}
          >
            <Icon className={`w-6 h-6 ${color}`} />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
              <span
                className={`font-mono text-xs px-2 py-0.5 rounded-full border bg-slate-800/60 border-slate-700/50 text-slate-500`}
              >
                Phase {phase}
              </span>
              <span className="flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Clock className="w-3 h-3" />
                Coming Soon
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed max-w-2xl">{description}</p>
          </div>
        </div>
      </div>

      {/* Planned features */}
      <div className="glass-card rounded-xl border border-slate-700/40 p-6">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider font-mono">
            Planned Features
          </h2>
        </div>
        <ul className="space-y-3">
          {features.map((feature, i) => (
            <li key={i} className="flex items-start gap-3">
              <div
                className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 ${bgColor} border ${borderColor}`}
              >
                <span className={`font-mono text-[10px] font-bold ${color}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <span className="text-slate-400 text-sm leading-relaxed">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Phase timeline hint */}
      <div className="mt-6 flex items-center gap-2">
        <div className="flex gap-1.5">
          {[1, 2, 3].map((p) => (
            <div
              key={p}
              className={`h-1 rounded-full transition-all ${
                p < phase
                  ? "w-8 bg-slate-700"
                  : p === phase
                  ? `w-12 bg-amber-500/60`
                  : "w-4 bg-slate-800"
              }`}
            />
          ))}
        </div>
        <span className="font-mono text-xs text-slate-600 ml-1">
          Phase {phase} of 3
        </span>
      </div>
    </div>
  );
}
