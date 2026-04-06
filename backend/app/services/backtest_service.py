"""
Backtest Service — CommodityIQ Phase 5
=======================================
Runs strategy backtests on historical signal data from Supabase.
Uses fixed-fraction position sizing (risk_per_trade × current equity).
Falls back to mock data when real settled trades < MIN_TRADES.
"""

import logging
import math
import random
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List

import numpy as np

from app.models.backtest import (
    AccuracyReport,
    BacktestConfig,
    BacktestResult,
    SymbolAccuracy,
)
from app.services import supabase_client

logger = logging.getLogger("commodityiq.backtest")

MIN_TRADES = 50   # minimum settled trades before falling back to mock


# ── Mock data generator ───────────────────────────────────────────────────────

def _mock_trades(config: BacktestConfig, n: int = 200) -> List[Dict[str, Any]]:
    """
    Generates realistic synthetic trade data seeded deterministically.
    Win probability scales with confidence to mimic a calibrated model.
    """
    rng = random.Random(42)
    trades: List[Dict[str, Any]] = []
    span_s = max((config.end_date - config.start_date).total_seconds(), 1)
    base_price = 2320.0

    for i in range(n):
        sig  = rng.choice(config.signal_types)
        conf = rng.uniform(max(config.min_confidence, 0.55), 0.95)
        rr   = rng.uniform(1.5, 3.2)
        entry = base_price + rng.uniform(-120, 120)
        # Win probability scales linearly with confidence
        win_prob = 0.45 + (conf - 0.55) * 0.55
        outcome  = "tp_hit" if rng.random() < win_prob else "sl_hit"
        ts = config.start_date + timedelta(seconds=span_s * i / n)

        trades.append({
            "symbol":            config.symbol,
            "signal_type":       sig,
            "confidence":        round(conf, 3),
            "entry_price":       round(entry, 2),
            "risk_reward_ratio": round(rr, 2),
            "outcome":           outcome,
            "generated_at":      ts.isoformat(),
            "metadata": {
                "tft_smc_agree": rng.random() > 0.35,
                "tft_available": True,
                "sl_source":     rng.choice(["atr", "smc"]),
                "tp_source":     rng.choice(["atr", "smc"]),
            },
        })
    return trades


# ── Backtest engine ───────────────────────────────────────────────────────────

def _run(trades: List[Dict[str, Any]], config: BacktestConfig, is_mock: bool) -> BacktestResult:
    capital  = config.initial_capital
    equity   = capital
    peak     = capital
    max_dd   = 0.0

    wins:     List[float] = []
    losses:   List[float] = []
    pnl_list: List[float] = []
    monthly:  Dict[str, float] = defaultdict(float)
    equity_curve: List[Dict]   = [{"date": config.start_date.date().isoformat(), "equity": equity}]
    trade_log:    List[Dict]   = []

    settled = [t for t in trades if t.get("outcome") in ("tp_hit", "sl_hit")]
    settled.sort(key=lambda t: t.get("generated_at", ""))

    for t in settled:
        outcome  = t["outcome"]
        rr       = float(t.get("risk_reward_ratio") or 1.5)
        risk_amt = equity * config.risk_per_trade

        pnl    = risk_amt * rr if outcome == "tp_hit" else -risk_amt
        equity = max(0.0, equity + pnl)

        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

        date_str = (t.get("generated_at") or "")[:10]
        equity_curve.append({"date": date_str, "equity": round(equity, 2)})
        monthly[date_str[:7]] += pnl
        pnl_list.append(pnl)

        (wins if outcome == "tp_hit" else losses).append(pnl)

        trade_log.append({
            "date":       date_str,
            "symbol":     t.get("symbol"),
            "type":       t.get("signal_type"),
            "confidence": t.get("confidence"),
            "outcome":    outcome,
            "pnl":        round(pnl, 2),
            "rr":         rr,
        })

    n            = len(pnl_list)
    win_rate     = len(wins) / n if n else 0.0
    total_pnl    = sum(pnl_list)
    gross_profit = sum(wins)
    gross_loss   = abs(sum(losses))

    if n > 1:
        arr    = np.array(pnl_list) / config.initial_capital
        sharpe = float(np.mean(arr) / (np.std(arr) + 1e-9) * math.sqrt(252))
    else:
        sharpe = 0.0

    monthly_returns = [
        {"month": k, "return_pct": round(v / config.initial_capital * 100, 2)}
        for k, v in sorted(monthly.items())
    ]

    return BacktestResult(
        total_trades    = n,
        winning_trades  = len(wins),
        losing_trades   = len(losses),
        win_rate        = round(win_rate, 3),
        total_pnl       = round(total_pnl, 2),
        total_pnl_pct   = round(total_pnl / config.initial_capital * 100, 2),
        max_drawdown    = round(max_dd, 4),
        sharpe_ratio    = round(sharpe, 2),
        profit_factor   = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0.0,
        avg_win         = round(sum(wins)   / len(wins),   2) if wins   else 0.0,
        avg_loss        = round(sum(losses) / len(losses), 2) if losses else 0.0,
        best_trade      = round(max(wins,   default=0.0), 2),
        worst_trade     = round(min(losses, default=0.0), 2),
        equity_curve    = equity_curve,
        monthly_returns = monthly_returns,
        trades          = trade_log,
        is_mock         = is_mock,
    )


# ── Accuracy helpers ──────────────────────────────────────────────────────────

def _conf_band(c: float) -> str:
    if c < 0.6: return "<0.6"
    if c < 0.7: return "0.6-0.7"
    if c < 0.8: return "0.7-0.8"
    if c < 0.9: return "0.8-0.9"
    return "0.9+"


def _session(iso: str) -> str:
    try:
        h = int(iso[11:13])
    except (IndexError, ValueError):
        return "unknown"
    if h >= 22 or h < 7:  return "asian"
    if 7  <= h < 12:       return "london"
    if 12 <= h < 16:       return "overlap"
    return "new_york"


def _build_accuracy(rows: List[Dict[str, Any]]) -> AccuracyReport:
    closed = [r for r in rows if r.get("outcome") in ("tp_hit", "sl_hit")]

    if not closed:
        return AccuracyReport(
            overall_win_rate=0.0, total_closed=0,
            by_symbol={}, by_confidence_band={}, by_session={},
            tft_accuracy=0.0, smc_accuracy=0.0,
            confluence_win_rate=0.0, single_source_win_rate=0.0,
            recent_trend="stable", insufficient_data=True,
        )

    def is_win(r: Dict) -> bool:
        return r.get("outcome") == "tp_hit"

    overall_wr = round(sum(1 for r in closed if is_win(r)) / len(closed), 3)

    # ── By symbol ────────────────────────────────────────────────────────────
    sym_bucket: Dict[str, Dict] = defaultdict(
        lambda: {"total": 0, "wins": 0, "losses": 0, "conf": 0.0, "rr": 0.0}
    )
    for r in closed:
        b = sym_bucket[r.get("symbol", "UNKNOWN")]
        b["total"] += 1
        b["wins"]  += 1 if is_win(r) else 0
        b["losses"] += 0 if is_win(r) else 1
        b["conf"]  += float(r.get("confidence") or 0)
        b["rr"]    += float(r.get("risk_reward_ratio") or 0)

    by_symbol = {
        sym: SymbolAccuracy(
            symbol         = sym,
            total          = b["total"],
            wins           = b["wins"],
            losses         = b["losses"],
            win_rate       = round(b["wins"] / b["total"], 3) if b["total"] else 0.0,
            avg_confidence = round(b["conf"] / b["total"], 3) if b["total"] else 0.0,
            avg_rr         = round(b["rr"]   / b["total"], 2) if b["total"] else 0.0,
        )
        for sym, b in sym_bucket.items()
    }

    # ── By confidence band ───────────────────────────────────────────────────
    band_bucket: Dict[str, Dict] = defaultdict(lambda: {"wins": 0, "total": 0})
    for r in closed:
        b = band_bucket[_conf_band(float(r.get("confidence") or 0))]
        b["total"] += 1
        b["wins"]  += 1 if is_win(r) else 0
    by_conf = {
        k: round(v["wins"] / v["total"], 3) if v["total"] else 0.0
        for k, v in sorted(band_bucket.items())
    }

    # ── By session ───────────────────────────────────────────────────────────
    sess_bucket: Dict[str, Dict] = defaultdict(lambda: {"wins": 0, "total": 0})
    for r in closed:
        b = sess_bucket[_session(r.get("generated_at", ""))]
        b["total"] += 1
        b["wins"]  += 1 if is_win(r) else 0
    by_sess = {
        k: round(v["wins"] / v["total"], 3) if v["total"] else 0.0
        for k, v in sorted(sess_bucket.items())
    }

    # ── Confluence vs single source ──────────────────────────────────────────
    conf_wins = conf_total = single_wins = single_total = 0
    for r in closed:
        meta  = r.get("metadata") or {}
        agree = meta.get("tft_smc_agree") if isinstance(meta, dict) else None
        if agree is True:
            conf_total += 1
            conf_wins  += 1 if is_win(r) else 0
        elif agree is False:
            single_total += 1
            single_wins  += 1 if is_win(r) else 0

    # ── Recent trend (last 30 vs prior 30) ──────────────────────────────────
    chron  = sorted(closed, key=lambda r: r.get("generated_at", ""))
    recent = chron[-30:]
    prior  = chron[-60:-30]
    r_wr   = sum(1 for r in recent if is_win(r)) / len(recent) if recent else 0.0
    p_wr   = sum(1 for r in prior  if is_win(r)) / len(prior)  if prior  else r_wr
    if   r_wr > p_wr + 0.05: trend = "improving"
    elif r_wr < p_wr - 0.05: trend = "declining"
    else:                     trend = "stable"

    return AccuracyReport(
        overall_win_rate       = overall_wr,
        total_closed           = len(closed),
        by_symbol              = by_symbol,
        by_confidence_band     = by_conf,
        by_session             = by_sess,
        tft_accuracy           = 0.0,   # requires tft_direction vs price outcome — future
        smc_accuracy           = 0.0,   # requires smc_bias vs price outcome — future
        confluence_win_rate    = round(conf_wins   / conf_total,   3) if conf_total   else 0.0,
        single_source_win_rate = round(single_wins / single_total, 3) if single_total else 0.0,
        recent_trend           = trend,
        insufficient_data      = len(closed) < 10,
    )


# ── Public API ────────────────────────────────────────────────────────────────

async def run_backtest(config: BacktestConfig) -> BacktestResult:
    rows = await supabase_client.fetch_closed_signals(
        symbol    = config.symbol,
        from_date = config.start_date.date().isoformat(),
        to_date   = config.end_date.date().isoformat(),
        limit     = 500,
    )

    settled = [
        r for r in rows
        if float(r.get("confidence") or 0) >= config.min_confidence
        and r.get("signal_type") in config.signal_types
    ]

    is_mock = len(settled) < MIN_TRADES
    if is_mock:
        logger.info(
            "Backtest [%s]: only %d settled trades — using mock data",
            config.symbol, len(settled),
        )
        settled = _mock_trades(config)

    return _run(settled, config, is_mock)


async def get_accuracy_report() -> AccuracyReport:
    rows = await supabase_client.fetch_closed_signals(limit=500)
    return _build_accuracy(rows)
