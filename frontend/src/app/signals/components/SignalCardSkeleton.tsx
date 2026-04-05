export default function SignalCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-20 rounded bg-slate-800" />
        <div className="h-6 w-16 rounded-full bg-slate-800" />
      </div>
      {/* Confidence label + bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between">
          <div className="h-3 w-16 rounded bg-slate-800" />
          <div className="h-3 w-8  rounded bg-slate-800" />
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-800" />
      </div>
      {/* Price rows */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex justify-between">
          <div className="h-3 w-8  rounded bg-slate-800" />
          <div className="h-3 w-20 rounded bg-slate-800" />
        </div>
      ))}
      {/* RR */}
      <div className="border-t border-slate-800 pt-2 flex justify-between">
        <div className="h-3 w-10 rounded bg-slate-800" />
        <div className="h-3 w-12 rounded bg-slate-800" />
      </div>
      {/* Footer */}
      <div className="border-t border-slate-800 pt-2 flex justify-between">
        <div className="h-3 w-16 rounded bg-slate-800" />
        <div className="h-3 w-10 rounded bg-slate-800" />
      </div>
    </div>
  );
}
