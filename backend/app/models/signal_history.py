"""
Signal history models — Phase 4.
"""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class SignalHistoryRecord(BaseModel):
    id:                Optional[str]   = None
    symbol:            str
    signal_type:       str             # BUY / SELL / WAIT
    confidence:        float
    entry_price:       Optional[float] = None
    take_profit:       Optional[float] = None
    stop_loss:         Optional[float] = None
    risk_reward_ratio: Optional[float] = None
    tft_direction:     Optional[str]   = None
    smc_bias:          Optional[str]   = None
    generated_at:      datetime
    valid_until:       datetime
    outcome:           str             = "pending"  # tp_hit / sl_hit / expired / pending
    outcome_price:     Optional[float] = None
    outcome_at:        Optional[datetime] = None
    metadata:          Optional[Dict]  = None
    created_at:        Optional[datetime] = None


class HistoryResponse(BaseModel):
    records: List[SignalHistoryRecord]
    total:   int
    limit:   int
    offset:  int


class SymbolStats(BaseModel):
    symbol:         str
    total:          int
    wins:           int   # tp_hit
    losses:         int   # sl_hit
    expired:        int
    pending:        int
    win_rate:       float # wins / (wins + losses), 0 if no closed trades
    avg_confidence: float
    avg_rr:         float


class StatsResponse(BaseModel):
    symbols: List[SymbolStats]
