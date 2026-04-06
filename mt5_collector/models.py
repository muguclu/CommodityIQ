from datetime import datetime

from pydantic import BaseModel


class OHLCVBar(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


class SymbolPayload(BaseModel):
    symbol: str
    timeframe: str = "M5"
    bars: list[OHLCVBar]
    source: str = "mt5"
