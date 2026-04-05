"""
Signal models for CommodityIQ Signal Engine (Phase 2).
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class SignalType(str, Enum):
    BUY  = "BUY"
    SELL = "SELL"
    WAIT = "WAIT"


class OHLCVBar(BaseModel):
    timestamp: str          # ISO-8601 e.g. "2024-01-15T10:05:00"
    open:   float
    high:   float
    low:    float
    close:  float
    volume: float


class MarketDataPayload(BaseModel):
    """Body sent by the MT5 collector on every tick / bar."""
    symbol:    str
    timeframe: str = "M5"   # MT5 timeframe string: M1 M5 M15 M30 H1 H4 D1
    bars:      List[OHLCVBar] = Field(..., min_length=1)
    source:    str = "mt5"


class Signal(BaseModel):
    symbol:              str
    signal_type:         SignalType
    confidence:          float           # 0.0 – 1.0
    entry_price:         float
    take_profit:         float
    stop_loss:           float
    risk_reward_ratio:   float
    tft_direction:       str             # "bullish" | "bearish" | "neutral"
    tft_forecast_price:  float
    smc_bias:            str             # "bullish" | "bearish" | "neutral"
    smc_key_levels:      Dict[str, List[float]]   # {"support": [...], "resistance": [...]}
    timeframe:           str
    generated_at:        datetime
    valid_until:         datetime        # generated_at + 15 min
    metadata:            Dict            # tft_available, bars_analyzed, etc.


class SignalResponse(BaseModel):
    signals:       List[Signal]
    last_updated:  datetime
    market_status: str                   # "open" | "closed" | "unknown"


class FeedResponse(BaseModel):
    status:             str
    signals_generated:  int
    symbol:             str
    bars_received:      int
