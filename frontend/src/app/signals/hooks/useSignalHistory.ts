"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryResponse, SignalHistoryRecord, StatsResponse, SymbolStats } from "../types";

const API = () => process.env.NEXT_PUBLIC_API_URL ?? "";

// ── History ───────────────────────────────────────────────────────────────────

export interface HistoryFilters {
  symbol?:      string;
  signal_type?: string;
  from_date?:   string;
  to_date?:     string;
  limit:        number;
  offset:       number;
}

export interface UseHistoryReturn {
  records:  SignalHistoryRecord[];
  total:    number;
  loading:  boolean;
  error:    string | null;
  refetch:  () => void;
}

export function useSignalHistory(filters: HistoryFilters): UseHistoryReturn {
  const [records,  setRecords]  = useState<SignalHistoryRecord[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.symbol)      params.set("symbol",      filters.symbol);
      if (filters.signal_type) params.set("signal_type", filters.signal_type);
      if (filters.from_date)   params.set("from_date",   filters.from_date);
      if (filters.to_date)     params.set("to_date",     filters.to_date);
      params.set("limit",  String(filters.limit));
      params.set("offset", String(filters.offset));

      const res = await fetch(`${API()}/api/signals/history?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HistoryResponse = await res.json();
      setRecords(json.records ?? []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [filters.symbol, filters.signal_type, filters.from_date, filters.to_date, filters.limit, filters.offset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  return { records, total, loading, error, refetch: fetchHistory };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface UseStatsReturn {
  stats:   SymbolStats[];
  loading: boolean;
  error:   string | null;
}

export function useSignalStats(): UseStatsReturn {
  const [stats,   setStats]   = useState<SymbolStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API()}/api/signals/stats`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: StatsResponse = await res.json();
        if (!cancelled) setStats(json.symbols ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { stats, loading, error };
}
