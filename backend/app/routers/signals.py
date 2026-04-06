"""
Signals Router — CommodityIQ Phase 2 / 4
==========================================
Endpoints:
  POST /api/signals/feed          ← MT5 collector pushes OHLCV bars (API-key protected)
  GET  /api/signals/latest        ← frontend polls for active signals
  GET  /api/signals/history       ← paginated signal history from Supabase
  GET  /api/signals/stats         ← per-symbol win rate and aggregate stats
  GET  /api/signals/health        ← collector connectivity + diagnostics
  GET  /api/signals/{symbol}      ← single symbol signal
"""

import logging
from collections import defaultdict
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
from app.models.backtest import AccuracyReport
from app.models.signal_history import HistoryResponse, SignalHistoryRecord, StatsResponse, SymbolStats
from app.services import backtest_service, supabase_client
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
    "/signals/history",
    response_model=HistoryResponse,
    summary="Paginated signal history from Supabase",
)
async def signal_history(
    symbol:      Optional[str] = Query(None),
    signal_type: Optional[str] = Query(None, description="BUY | SELL | WAIT"),
    from_date:   Optional[str] = Query(None, description="ISO date e.g. 2024-01-01"),
    to_date:     Optional[str] = Query(None, description="ISO date e.g. 2024-12-31"),
    limit:       int           = Query(50, ge=1, le=500),
    offset:      int           = Query(0, ge=0),
) -> HistoryResponse:
    rows = await supabase_client.fetch_history(
        symbol=symbol,
        signal_type=signal_type,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
        offset=offset,
    )
    records = [SignalHistoryRecord(**r) for r in rows]
    return HistoryResponse(records=records, total=len(records), limit=limit, offset=offset)


@router.get(
    "/signals/stats",
    response_model=StatsResponse,
    summary="Per-symbol win rate and aggregate stats",
)
async def signal_stats() -> StatsResponse:
    rows = await supabase_client.fetch_stats()

    buckets: dict = defaultdict(lambda: {"total": 0, "wins": 0, "losses": 0,
                                          "expired": 0, "pending": 0,
                                          "conf_sum": 0.0, "rr_sum": 0.0})
    for r in rows:
        sym = r.get("symbol", "UNKNOWN")
        b   = buckets[sym]
        b["total"] += 1
        outcome = r.get("outcome", "pending")
        if outcome == "tp_hit":   b["wins"]    += 1
        elif outcome == "sl_hit": b["losses"]  += 1
        elif outcome == "expired":b["expired"] += 1
        else:                     b["pending"] += 1
        b["conf_sum"] += r.get("confidence", 0.0) or 0.0
        b["rr_sum"]   += r.get("risk_reward_ratio", 0.0) or 0.0

    stats = []
    for sym, b in buckets.items():
        closed = b["wins"] + b["losses"]
        stats.append(SymbolStats(
            symbol         = sym,
            total          = b["total"],
            wins           = b["wins"],
            losses         = b["losses"],
            expired        = b["expired"],
            pending        = b["pending"],
            win_rate       = round(b["wins"] / closed, 3) if closed > 0 else 0.0,
            avg_confidence = round(b["conf_sum"] / b["total"], 3) if b["total"] else 0.0,
            avg_rr         = round(b["rr_sum"]   / b["total"], 2) if b["total"] else 0.0,
        ))

    stats.sort(key=lambda s: s.total, reverse=True)
    return StatsResponse(symbols=stats)


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
    "/signals/accuracy",
    response_model=AccuracyReport,
    summary="Overall and per-symbol signal accuracy metrics",
)
async def signal_accuracy() -> AccuracyReport:
    return await backtest_service.get_accuracy_report()


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
