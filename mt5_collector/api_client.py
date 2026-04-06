import time
from pathlib import Path

import httpx

from config import API_BASE_URL, API_KEY
from logger import get_logger
from models import OHLCVBar, SymbolPayload

logger = get_logger(__name__)

BUFFER_FILE = Path(__file__).parent / "logs" / "unsent_buffer.jsonl"

_FEED_ENDPOINT = "/api/signals/feed"
_HEALTH_ENDPOINT = "/health"


def _headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    return headers


def check_api_health() -> bool:
    url = f"{API_BASE_URL.rstrip('/')}{_HEALTH_ENDPOINT}"
    try:
        resp = httpx.get(url, timeout=10.0)
        if resp.status_code == 200:
            logger.info("API health check OK — %s", url)
            return True
        logger.warning("API health check returned %d", resp.status_code)
        return False
    except Exception as exc:
        logger.warning("API health check failed: %s", exc)
        return False


def _post_payload(payload: SymbolPayload, timeout: float = 30.0) -> bool:
    url = f"{API_BASE_URL.rstrip('/')}{_FEED_ENDPOINT}"
    body = payload.model_dump(mode="json")

    for attempt in range(1, 4):
        try:
            resp = httpx.post(url, json=body, headers=_headers(), timeout=timeout)
            if resp.status_code in (200, 201, 202):
                logger.info(
                    "POST %s — symbol=%s status=%d bars=%d",
                    _FEED_ENDPOINT,
                    payload.symbol,
                    resp.status_code,
                    len(payload.bars),
                )
                return True
            logger.warning(
                "POST attempt %d/%d — symbol=%s status=%d body=%s",
                attempt,
                3,
                payload.symbol,
                resp.status_code,
                resp.text[:200],
            )
        except httpx.TimeoutException:
            logger.warning("POST attempt %d/%d — symbol=%s timeout after %.0fs", attempt, 3, payload.symbol, timeout)
        except Exception as exc:
            logger.warning("POST attempt %d/%d — symbol=%s error: %s", attempt, 3, payload.symbol, exc)

        if attempt < 3:
            backoff = 2 ** attempt
            logger.info("Retrying in %ds…", backoff)
            time.sleep(backoff)

    return False


def _buffer_payload(payload: SymbolPayload) -> None:
    BUFFER_FILE.parent.mkdir(exist_ok=True)
    with BUFFER_FILE.open("a", encoding="utf-8") as fh:
        fh.write(payload.model_dump_json() + "\n")
    logger.info("Payload buffered locally — symbol=%s bars=%d", payload.symbol, len(payload.bars))


def _flush_buffer() -> None:
    if not BUFFER_FILE.exists():
        return

    lines = BUFFER_FILE.read_text(encoding="utf-8").splitlines()
    if not lines:
        return

    logger.info("Flushing %d buffered payloads…", len(lines))
    remaining: list[str] = []

    for line in lines:
        try:
            payload = SymbolPayload.model_validate_json(line)
            if not _post_payload(payload):
                remaining.append(line)
        except Exception as exc:
            logger.error("Corrupt buffer entry, discarding: %s", exc)

    if remaining:
        BUFFER_FILE.write_text("\n".join(remaining) + "\n", encoding="utf-8")
        logger.warning("%d payloads still buffered after flush attempt", len(remaining))
    else:
        BUFFER_FILE.unlink(missing_ok=True)
        logger.info("Buffer fully flushed")


def send_market_data(bars: list[dict]) -> bool:
    if not bars:
        logger.warning("send_market_data called with empty bars list")
        return False

    _flush_buffer()

    grouped: dict[str, list[dict]] = {}
    for bar in bars:
        grouped.setdefault(bar["symbol"], []).append(bar)

    all_success = True
    for symbol, symbol_bars in grouped.items():
        ohlcv_bars = [
            OHLCVBar(
                timestamp=b["timestamp"],
                open=b["open"],
                high=b["high"],
                low=b["low"],
                close=b["close"],
                volume=b["volume"],
            )
            for b in symbol_bars
        ]
        payload = SymbolPayload(
            symbol=symbol,
            timeframe=symbol_bars[0].get("timeframe", "M5"),
            bars=ohlcv_bars,
        )
        success = _post_payload(payload)
        if not success:
            _buffer_payload(payload)
            all_success = False

    return all_success
