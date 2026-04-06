"use client";

import { useEffect, useState } from "react";

const API = () => process.env.NEXT_PUBLIC_API_URL ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  symbol:           string;
  start_date:       string;  // ISO datetime
  end_date:         string;
  initial_capital:  number;
  risk_per_trade:   number;
  min_confidence:   number;
  signal_types:     string[];
}

export interface BacktestResult {
  total_trades:    number;
  winning_trades:  number;
  losing_trades:   number;
  win_rate:        number;
  total_pnl:       number;
  total_pnl_pct:   number;
  max_drawdown:    number;
  sharpe_ratio:    number;
  profit_factor:   number;
  avg_win:         number;
  avg_loss:        number;
  best_trade:      number;
  worst_trade:     number;
  equity_curve:    { date: string; equity: number }[];
  monthly_returns: { month: string; return_pct: number }[];
  trades:          {
    date: string; symbol: string; type: string;
    confidence: number; outcome: string; pnl: number; rr: number;
  }[];
  is_mock: boolean;
}

export interface SymbolAccuracy {
  symbol:         string;
  total:          number;
  wins:           number;
  losses:         number;
  win_rate:       number;
  avg_confidence: number;
  avg_rr:         number;
}

export interface AccuracyReport {
  overall_win_rate:        number;
  total_closed:            number;
  by_symbol:               Record<string, SymbolAccuracy>;
  by_confidence_band:      Record<string, number>;
  by_session:              Record<string, number>;
  tft_accuracy:            number;
  smc_accuracy:            number;
  confluence_win_rate:     number;
  single_source_win_rate:  number;
  recent_trend:            string;
  insufficient_data:       boolean;
}

// ── Backtest hook ─────────────────────────────────────────────────────────────

export interface UseBacktestReturn {
  result:  BacktestResult | null;
  loading: boolean;
  error:   string | null;
  run:     (config: BacktestConfig) => Promise<void>;
  reset:   () => void;
}

export function useBacktest(): UseBacktestReturn {
  const [result,  setResult]  = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function run(config: BacktestConfig) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API()}/api/backtest/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(config),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  return { result, loading, error, run, reset: () => { setResult(null); setError(null); } };
}

// ── Accuracy hook ─────────────────────────────────────────────────────────────

export interface UseAccuracyReturn {
  report:  AccuracyReport | null;
  loading: boolean;
  error:   string | null;
}

export function useAccuracy(): UseAccuracyReturn {
  const [report,  setReport]  = useState<AccuracyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API()}/api/signals/accuracy`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AccuracyReport = await res.json();
        if (!cancelled) setReport(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load accuracy");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { report, loading, error };
}
