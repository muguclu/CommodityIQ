from datetime import datetime

from pydantic import BaseModel, Field


class OHLCVBar(BaseModel):
    symbol: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    timeframe: str = "M5"


class MarketDataPayload(BaseModel):
    bars: list[OHLCVBar]
    collector_version: str = "1.0.0"
    sent_at: datetime = Field(default_factory=datetime.utcnow)
