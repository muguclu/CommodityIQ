"""
Backtest & Accuracy models — CommodityIQ Phase 5
"""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class BacktestConfig(BaseModel):
    symbol:          str
    start_date:      datetime
    end_date:        datetime
    initial_capital: float      = 10_000.0
    risk_per_trade:  float      = 0.02       # 2 % of equity per trade
    min_confidence:  float      = 0.6
    signal_types:    List[str]  = ["BUY", "SELL"]


class BacktestResult(BaseModel):
    total_trades:    int
    winning_trades:  int
    losing_trades:   int
    win_rate:        float
    total_pnl:       float
    total_pnl_pct:   float
    max_drawdown:    float       # fraction, e.g. 0.083 = -8.3 %
    sharpe_ratio:    float
    profit_factor:   float
    avg_win:         float
    avg_loss:        float
    best_trade:      float
    worst_trade:     float
    equity_curve:    List[Dict]  # [{date, equity}]
    monthly_returns: List[Dict]  # [{month, return_pct}]
    trades:          List[Dict]  # individual trade log
    is_mock:         bool = False


class SymbolAccuracy(BaseModel):
    symbol:         str
    total:          int
    wins:           int
    losses:         int
    win_rate:       float
    avg_confidence: float
    avg_rr:         float


class AccuracyReport(BaseModel):
    overall_win_rate:        float
    total_closed:            int
    by_symbol:               Dict[str, SymbolAccuracy]
    by_confidence_band:      Dict[str, float]   # {"0.6-0.7": 0.55, ...}
    by_session:              Dict[str, float]   # {"london": 0.72, ...}
    tft_accuracy:            float
    smc_accuracy:            float
    confluence_win_rate:     float
    single_source_win_rate:  float
    recent_trend:            str                # "improving" | "stable" | "declining"
    insufficient_data:       bool = False
