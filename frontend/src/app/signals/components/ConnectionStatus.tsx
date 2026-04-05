"use client";

interface Props {
  loading:     boolean;
  error:       string | null;
  lastUpdated: Date | null;
  isStale:     boolean;
  onRefresh:   () => void;
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function ConnectionStatus({ loading, error, lastUpdated, isStale, onRefresh }: Props) {
  const connected = !error && !loading;

  return (
    <div className="flex items-center gap-3">
      {/* Dot */}
      <span className="relative flex h-2 w-2 shrink-0">
        {connected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            error   ? "bg-red-500" :
            loading ? "bg-amber-400" :
                      "bg-emerald-400"
          }`}
        />
      </span>

      {/* Status text */}
      <span className={`text-xs ${error ? "text-red-400" : "text-slate-500"}`}>
        {error
          ? "Disconnected"
          : loading
          ? "Connecting…"
          : "Live"}
      </span>

      {/* Last updated */}
      {lastUpdated && !error && (
        <span className={`text-xs ${isStale ? "text-amber-400" : "text-slate-600"}`}>
          {isStale && <span className="mr-1">⚠</span>}
          {timeAgo(lastUpdated)}
        </span>
      )}

      {/* Refresh button */}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="ml-1 rounded p-1 text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
        aria-label="Refresh signals"
        title="Refresh now"
      >
        <svg className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M4 4v6h6M20 20v-6h-6" />
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 10m15.36 3.36L18 18a9 9 0 0 1-14.85-3.36" />
        </svg>
      </button>
    </div>
  );
}
