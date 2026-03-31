import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    CommodityDataset,
    CommodityInfo,
    DatasetMetadata,
    DateRange,
    FetchMarketRequest,
    FetchMarketResponse,
    OHLCVRecord,
)

router = APIRouter(tags=["market"])

COMMODITIES = [
    {"ticker": "BZ=F", "name": "Brent Crude Oil", "category": "Energy", "currency": "USD"},
    {"ticker": "CL=F", "name": "WTI Crude Oil", "category": "Energy", "currency": "USD"},
    {"ticker": "NG=F", "name": "Natural Gas", "category": "Energy", "currency": "USD"},
    {"ticker": "GC=F", "name": "Gold", "category": "Metals", "currency": "USD"},
    {"ticker": "SI=F", "name": "Silver", "category": "Metals", "currency": "USD"},
    {"ticker": "HG=F", "name": "Copper", "category": "Metals", "currency": "USD"},
    {"ticker": "PL=F", "name": "Platinum", "category": "Metals", "currency": "USD"},
    {"ticker": "ZW=F", "name": "Wheat", "category": "Agriculture", "currency": "USD"},
    {"ticker": "ZC=F", "name": "Corn", "category": "Agriculture", "currency": "USD"},
    {"ticker": "ZS=F", "name": "Soybean", "category": "Agriculture", "currency": "USD"},
    {"ticker": "KC=F", "name": "Coffee", "category": "Agriculture", "currency": "USD"},
    {"ticker": "CT=F", "name": "Cotton", "category": "Agriculture", "currency": "USD"},
]

_TICKER_MAP: dict[str, dict] = {c["ticker"]: c for c in COMMODITIES}

INTERVAL_MAX_DAYS: dict[str, int | None] = {
    "5m":  60,
    "15m": 60,
    "1h":  730,
    "1d":  None,
    "1wk": None,
    "1mo": None,
}

INTRADAY_INTERVALS = {"5m", "15m", "1h"}


def _safe(val: Any, default: float = 0.0) -> float:
    try:
        f = float(val)
        return default if pd.isna(f) else f
    except (ValueError, TypeError):
        return default


@router.get("/commodities", response_model=list[CommodityInfo])
async def get_commodities():
    return [CommodityInfo(**c) for c in COMMODITIES]


@router.post("/fetch", response_model=FetchMarketResponse)
async def fetch_market_data(request: FetchMarketRequest):
    if not request.tickers:
        raise HTTPException(status_code=400, detail="At least one ticker is required.")

    end_dt = request.end_date or date.today().isoformat()
    start_dt = request.start_date or (date.today() - timedelta(days=5 * 365)).isoformat()

    # Clamp start_date to interval's maximum lookback window
    fetch_warnings: list[str] = []
    max_days = INTERVAL_MAX_DAYS.get(request.interval)
    if max_days is not None:
        min_start = (date.today() - timedelta(days=max_days)).isoformat()
        if start_dt < min_start:
            start_dt = min_start
            fetch_warnings.append(
                f"{request.interval} interval is limited to {max_days} days of history. "
                f"Start date clamped to {start_dt}."
            )

    is_intraday = request.interval in INTRADAY_INTERVALS
    results: list[CommodityDataset] = []
    fetch_errors: list[str] = []

    for ticker in request.tickers:
        try:
            t = yf.Ticker(ticker)
            df = t.history(
                start=start_dt,
                end=end_dt,
                interval=request.interval,
                auto_adjust=True,
            )

            if df is None or df.empty:
                fetch_errors.append(f"{ticker}: no data returned for the requested range.")
                continue

            # Normalize column names (some yfinance versions vary)
            df.columns = [str(c).strip() for c in df.columns]

            # Drop non-OHLCV columns returned by .history()
            for _col in ("Dividends", "Stock Splits", "Capital Gains"):
                if _col in df.columns:
                    df = df.drop(columns=[_col])

            # Strip timezone from DatetimeIndex so strftime works cleanly
            if hasattr(df.index, "tz") and df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            records: list[OHLCVRecord] = []
            for dt_idx, row in df.iterrows():
                close_val = _safe(row.get("Close", 0.0))
                if close_val == 0.0:
                    continue
                # Intraday: full ISO datetime; daily+: date only
                date_str = (
                    dt_idx.strftime("%Y-%m-%dT%H:%M:%S")
                    if is_intraday
                    else dt_idx.strftime("%Y-%m-%d")
                )
                records.append(
                    OHLCVRecord(
                        date=date_str,
                        open=_safe(row.get("Open", close_val), close_val),
                        high=_safe(row.get("High", close_val), close_val),
                        low=_safe(row.get("Low", close_val), close_val),
                        close=close_val,
                        volume=_safe(row.get("Volume", 0.0)),
                    )
                )

            if not records:
                fetch_errors.append(f"{ticker}: no valid records after cleaning.")
                continue

            info = _TICKER_MAP.get(ticker, {})
            results.append(
                CommodityDataset(
                    id=str(uuid.uuid4()),
                    name=info.get("name", ticker),
                    ticker=ticker,
                    source="api",
                    records=records,
                    dateRange=DateRange(start=records[0].date, end=records[-1].date),
                    metadata=DatasetMetadata(
                        rowCount=len(records),
                        columns=["date", "open", "high", "low", "close", "volume"],
                        uploadedAt=datetime.now(timezone.utc).isoformat(),
                        currency=info.get("currency"),
                    ),
                )
            )
        except Exception as exc:
            fetch_errors.append(f"{ticker}: {str(exc)[:120]}")

    return FetchMarketResponse(
        datasets=results,
        warnings=fetch_warnings,
        errors=fetch_errors,
    )
