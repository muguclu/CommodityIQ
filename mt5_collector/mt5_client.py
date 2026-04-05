import time
from datetime import timezone

import MetaTrader5 as mt5
import pandas as pd

from config import MT5_LOGIN, MT5_PASSWORD, MT5_SERVER
from logger import get_logger

logger = get_logger(__name__)

_INITIALIZED: bool = False


def initialize_mt5(max_retries: int = 3, retry_delay: float = 5.0) -> bool:
    global _INITIALIZED

    for attempt in range(1, max_retries + 1):
        logger.info(
            "MT5 init attempt %d/%d — server=%s login=%s",
            attempt,
            max_retries,
            MT5_SERVER,
            MT5_LOGIN,
        )

        if not mt5.initialize():
            logger.error(
                "mt5.initialize() failed: %s", mt5.last_error()
            )
        else:
            authorized = mt5.login(
                login=MT5_LOGIN,
                password=MT5_PASSWORD,
                server=MT5_SERVER,
            )
            if authorized:
                info = mt5.account_info()
                logger.info(
                    "MT5 connected — account=%s server=%s balance=%.2f",
                    info.login if info else MT5_LOGIN,
                    info.server if info else MT5_SERVER,
                    info.balance if info else 0.0,
                )
                _INITIALIZED = True
                return True
            else:
                logger.error(
                    "MT5 login failed (attempt %d): %s", attempt, mt5.last_error()
                )
                mt5.shutdown()

        if attempt < max_retries:
            logger.info("Retrying in %.0f seconds…", retry_delay)
            time.sleep(retry_delay * attempt)

    _INITIALIZED = False
    return False


def ensure_connected() -> bool:
    global _INITIALIZED
    if not _INITIALIZED or mt5.terminal_info() is None:
        logger.warning("MT5 connection lost — attempting reconnect")
        _INITIALIZED = False
        return initialize_mt5()
    return True


def get_ohlcv(
    symbol: str,
    timeframe: int = mt5.TIMEFRAME_M5,
    bars: int = 100,
) -> pd.DataFrame | None:
    if not ensure_connected():
        logger.error("Cannot fetch %s — MT5 not connected", symbol)
        return None

    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, bars)

    if rates is None or len(rates) == 0:
        err = mt5.last_error()
        logger.warning("No data for %s: %s", symbol, err)
        return None

    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.rename(
        columns={
            "time":       "timestamp",
            "open":       "open",
            "high":       "high",
            "low":        "low",
            "close":      "close",
            "tick_volume": "volume",
        }
    )
    df["symbol"] = symbol
    df["timestamp"] = df["timestamp"].dt.tz_convert(timezone.utc)

    keep = ["timestamp", "open", "high", "low", "close", "volume", "symbol"]
    available = [c for c in keep if c in df.columns]
    df = df[available]

    logger.debug("Fetched %d bars for %s", len(df), symbol)
    return df


def shutdown_mt5() -> None:
    global _INITIALIZED
    mt5.shutdown()
    _INITIALIZED = False
    logger.info("MT5 connection closed")
