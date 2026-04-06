"""
Backtest Router — CommodityIQ Phase 5
======================================
Endpoints:
  POST /api/backtest/run        ← run strategy backtest on historical signals

Note: GET /api/signals/accuracy lives in signals.py (before the {symbol} catch-all).
"""

import logging

from fastapi import APIRouter, HTTPException, status

from app.models.backtest import BacktestConfig, BacktestResult
from app.services import backtest_service

logger = logging.getLogger("commodityiq.backtest.router")
router = APIRouter(tags=["backtest"])


@router.post(
    "/backtest/run",
    response_model=BacktestResult,
    summary="Run strategy backtest on historical signals",
)
async def run_backtest(config: BacktestConfig) -> BacktestResult:
    if config.end_date <= config.start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be after start_date",
        )
    if config.initial_capital <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="initial_capital must be positive",
        )
    return await backtest_service.run_backtest(config)


