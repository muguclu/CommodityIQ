"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Signal, SignalResponse } from "../types";

const POLL_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes

export interface UseSignalsReturn {
  signals:     Signal[];
  loading:     boolean;
  error:       string | null;
  lastUpdated: Date | null;
  isStale:     boolean;
  refetch:     () => void;
}

export function useSignals(): UseSignalsReturn {
  const [signals,     setSignals]     = useState<Signal[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const abortRef = useRef<AbortController | null>(null);

  const fetchSignals = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${apiUrl}/api/signals/latest`, {
        signal: ctrl.signal,
        cache:  "no-store",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json: SignalResponse = await res.json();
      setSignals(json.signals ?? []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "Signal service unavailable"
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchSignals();
    const id = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchSignals]);

  const isStale =
    lastUpdated !== null &&
    Date.now() - lastUpdated.getTime() > STALE_THRESHOLD_MS;

  return { signals, loading, error, lastUpdated, isStale, refetch: fetchSignals };
}
