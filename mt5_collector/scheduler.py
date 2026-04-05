import signal
import sys

import MetaTrader5 as mt5
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from api_client import send_market_data
from config import BARS_PER_REQUEST, INSTRUMENTS
from logger import get_logger
from mt5_client import get_ohlcv, shutdown_mt5

logger = get_logger(__name__)

_scheduler: BlockingScheduler | None = None


def collect_and_send() -> None:
    logger.info("─── Cycle start ─── instruments=%s", INSTRUMENTS)

    all_bars: list[dict] = []
    skipped: list[str] = []

    for symbol in INSTRUMENTS:
        df = get_ohlcv(symbol, timeframe=mt5.TIMEFRAME_M5, bars=BARS_PER_REQUEST)
        if df is None or df.empty:
            skipped.append(symbol)
            logger.warning("Skipping %s — no data returned", symbol)
            continue

        for row in df.to_dict(orient="records"):
            all_bars.append(
                {
                    "symbol":    row["symbol"],
                    "timestamp": row["timestamp"],
                    "open":      float(row["open"]),
                    "high":      float(row["high"]),
                    "low":       float(row["low"]),
                    "close":     float(row["close"]),
                    "volume":    float(row["volume"]),
                    "timeframe": "M5",
                }
            )

    logger.info(
        "Cycle collected %d bars across %d instruments (skipped: %s)",
        len(all_bars),
        len(INSTRUMENTS) - len(skipped),
        skipped or "none",
    )

    if all_bars:
        success = send_market_data(all_bars)
        if success:
            logger.info("Cycle complete — data sent successfully")
        else:
            logger.warning("Cycle complete — data buffered (API unreachable)")
    else:
        logger.warning("Cycle complete — nothing to send")


def _on_job_event(event) -> None:
    if event.code == EVENT_JOB_MISSED:
        logger.warning("Scheduled job was missed (job_id=%s)", event.job_id)
    elif event.code == EVENT_JOB_ERROR:
        logger.error(
            "Scheduled job raised an exception (job_id=%s): %s",
            event.job_id,
            event.exception,
            exc_info=event.traceback,
        )


def _handle_shutdown(signum, frame) -> None:
    logger.info("Shutdown signal received (%s) — stopping scheduler…", signum)
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    shutdown_mt5()
    sys.exit(0)


def start_scheduler(interval_seconds: int = 300) -> None:
    global _scheduler

    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    _scheduler = BlockingScheduler(timezone="UTC")
    _scheduler.add_listener(_on_job_event, EVENT_JOB_ERROR | EVENT_JOB_MISSED)

    _scheduler.add_job(
        collect_and_send,
        trigger=IntervalTrigger(seconds=interval_seconds),
        id="collect_and_send",
        name="MT5 OHLCV collector",
        misfire_grace_time=60,
        coalesce=True,
        max_instances=1,
    )

    logger.info(
        "Scheduler started — interval=%ds instruments=%s",
        interval_seconds,
        INSTRUMENTS,
    )

    try:
        _scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")
    finally:
        shutdown_mt5()
