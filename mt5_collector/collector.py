"""
CommodityIQ — MT5 Data Collector
Entry point: python collector.py [--once] [--interval SECONDS]
"""

import argparse
import sys

import MetaTrader5 as mt5

from api_client import check_api_health, send_market_data
from config import API_BASE_URL, BARS_PER_REQUEST, INSTRUMENTS, MT5_LOGIN, MT5_SERVER
from logger import get_logger
from mt5_client import get_ohlcv, initialize_mt5, shutdown_mt5
from scheduler import collect_and_send, start_scheduler

logger = get_logger("collector")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="CommodityIQ MT5 OHLCV Data Collector"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single collection cycle and exit (useful for testing)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=300,
        metavar="SECONDS",
        help="Collection interval in seconds (default: 300 = 5 minutes)",
    )
    return parser.parse_args()


def _startup_checks() -> bool:
    logger.info("═══════════════════════════════════════")
    logger.info("CommodityIQ MT5 Collector v1.0.0")
    logger.info("Login=%s  Server=%s", MT5_LOGIN, MT5_SERVER)
    logger.info("API=%s", API_BASE_URL)
    logger.info("Instruments=%s", INSTRUMENTS)
    logger.info("Bars/request=%d", BARS_PER_REQUEST)
    logger.info("═══════════════════════════════════════")

    logger.info("Checking MT5 connection…")
    if not initialize_mt5():
        logger.critical("MT5 initialisation failed — cannot start collector")
        return False

    logger.info("Checking API health…")
    api_ok = check_api_health()
    if not api_ok:
        logger.warning(
            "API health check failed — collector will buffer data locally until API is reachable"
        )

    return True


def _run_once() -> None:
    logger.info("Running single collection cycle (--once mode)")
    collect_and_send()
    shutdown_mt5()
    logger.info("Done.")


def main() -> None:
    args = _parse_args()

    if not _startup_checks():
        sys.exit(1)

    if args.once:
        _run_once()
    else:
        logger.info("Starting scheduler — interval=%ds", args.interval)
        start_scheduler(interval_seconds=args.interval)


if __name__ == "__main__":
    main()
