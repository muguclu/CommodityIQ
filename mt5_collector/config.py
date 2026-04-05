import os

from dotenv import load_dotenv

load_dotenv()

# ── MT5 credentials ──────────────────────────────────────────────────────────
MT5_LOGIN: int = int(os.environ.get("MT5_LOGIN", "0"))
MT5_PASSWORD: str = os.environ.get("MT5_PASSWORD", "")
MT5_SERVER: str = os.environ.get("MT5_SERVER", "Vantage-Live")

# ── API settings ─────────────────────────────────────────────────────────────
API_BASE_URL: str = os.environ.get("API_BASE_URL", "http://localhost:8000")
API_KEY: str = os.environ.get("API_KEY", "")

# ── Collector behaviour ───────────────────────────────────────────────────────
INSTRUMENTS: list[str] = [
    symbol.strip()
    for symbol in os.environ.get(
        "INSTRUMENTS", "XAUUSD"
    ).split(",")
    if symbol.strip()
]

BARS_PER_REQUEST: int = int(os.environ.get("BARS_PER_REQUEST", "100"))

COLLECTOR_VERSION: str = "1.0.0"
