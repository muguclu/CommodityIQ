"""
Signals Router — CommodityIQ Phase 2
======================================
Endpoints:
  POST /api/signals/feed          ← MT5 collector pushes OHLCV bars (API-key protected)
  GET  /api/signals/latest        ← frontend polls for active signals
  GET  /api/signals/{symbol}      ← single symbol signal
  GET  /api/signals/health        ← collector connectivity + diagnostics
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.models.signal import (
    FeedResponse,
    MarketDataPayload,
    Signal,
    SignalResponse,
    SignalType,
)
from app.services.signal_service import signal_service

logger = logging.getLogger("commodityiq.signals.router")
router = APIRouter(tags=["signals"])
bearer = HTTPBearer(auto_error=False)


# ── Auth dependency ──────────────────────────────────────────────────────────

def _require_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> None:
    """Validates Bearer token against SIGNAL_API_KEY from config."""
    if not settings.SIGNAL_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SIGNAL_API_KEY is not configured on the server.",
        )
    token = credentials.credentials if credentials else None
    if token != settings.SIGNAL_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/signals/feed",
    response_model=FeedResponse,
    summary="Ingest OHLCV bars from MT5 collector",
    dependencies=[Depends(_require_api_key)],
)
async def feed(payload: MarketDataPayload) -> FeedResponse:
    """
    Receives OHLCV bars from the MT5 data collector.
    Stores the bars and triggers async signal generation.
    Requires `Authorization: Bearer <SIGNAL_API_KEY>`.
    """
    return await signal_service.ingest(payload)


@router.get(
    "/signals/latest",
    response_model=SignalResponse,
    summary="Get all active signals",
)
async def latest_signals(
    symbol:      Optional[str]        = Query(None, description="Filter by symbol, e.g. XAUUSD"),
    signal_type: Optional[SignalType] = Query(None, description="Filter by type: BUY | SELL | WAIT"),
) -> SignalResponse:
    """
    Returns all non-expired signals.
    Optional query params: `symbol`, `signal_type`.
    """
    from datetime import datetime
    signals = await signal_service.get_latest_signals(symbol=symbol, signal_type=signal_type)
    return SignalResponse(
        signals=signals,
        last_updated=datetime.utcnow(),
        market_status="unknown",
    )


@router.get(
    "/signals/health",
    summary="Signal engine health & collector status",
)
async def signals_health() -> dict:
    """
    Returns:
    - tracked symbols and bar counts
    - last time data was received per symbol
    - number of currently active (non-expired) signals
    - which symbols have a cached TFT result
    """
    return await signal_service.health_info()


@router.get(
    "/signals/{symbol}",
    response_model=Signal,
    summary="Get latest signal for a specific symbol",
)
async def signal_for_symbol(symbol: str) -> Signal:
    """
    Returns the latest non-expired signal for `symbol`.
    Raises 404 if no signal exists or it has expired.
    """
    sig = await signal_service.get_signal_for_symbol(symbol)
    if sig is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active signal found for {symbol.upper()}. "
                   "POST bars to /api/signals/feed first.",
        )
    return sig
