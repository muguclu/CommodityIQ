"""
Signal Service — CommodityIQ Phase 2
======================================
Manages an in-memory OHLCV store and generates trading signals by combining
TFT forecast + SMC analysis (confluence scoring).

Architecture decisions:
- One asyncio.Lock protects all shared state.
- TFT runs in a dedicated ThreadPoolExecutor (1 worker) because it is CPU-bound.
  Its result is cached per symbol for TFT_CACHE_MINUTES to avoid re-training
  on every incoming bar.
- SMC analysis is lighter but also offloaded to the default executor.
- Signal generation is triggered as a background asyncio Task after each ingest,
  so the POST /feed endpoint returns immediately.
"""

import asyncio
import logging
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.models.signal import (
    FeedResponse,
    MarketDataPayload,
    OHLCVBar,
    Signal,
    SignalType,
)
from app.services.hybrid_forecast import HybridForecaster
from app.services.smc_engine import SMCEngine
from app.services import supabase_client

logger = logging.getLogger("commodityiq.signals")

TFT_CACHE_MINUTES = 30          # re-train TFT at most once per 30 min per symbol
MIN_BARS_FOR_SIGNAL = 20        # need at least 20 bars to generate any signal
ANALYSIS_WINDOW = 100           # bars fed into SMC / TFT
SIGNAL_VALIDITY_MINUTES = 15    # valid_until = generated_at + 15 min
RR_MINIMUM = 1.5                # minimum risk:reward; below this → WAIT
SL_BUFFER_PCT = 0.002           # 0.2 % buffer beyond the zone boundary

# ATR-based TP/SL parameters (Hybrid ATR + SMC, tuned for M5)
ATR_PERIOD          = 14   # lookback for ATR calculation
ATR_SL_MULTIPLIER   = 1.0  # SL fallback: entry ± 1.0 × ATR
ATR_TP_MULTIPLIER   = 2.0  # TP fallback: entry ± 2.0 × ATR — guarantees RR ≥ 2.0
MAX_ATR_DISTANCE    = 3.0  # SMC zone ignored if abs(zone − entry) > ATR × 3.0


class SignalService:
    def __init__(self) -> None:
        # Raw OHLCV store — {SYMBOL: deque(maxlen=500)}
        self._store:         Dict[str, deque]                     = {}
        # Latest generated signal per symbol
        self._signal_cache:  Dict[str, Signal]                    = {}
        # TFT result cache — {SYMBOL: (result_dict, timestamp)}
        self._tft_cache:     Dict[str, Tuple[dict, datetime]]     = {}
        # Last time data was received per symbol
        self._last_received: Dict[str, datetime]                  = {}

        self._lock         = asyncio.Lock()
        self._tft_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tft-signal")

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    async def ingest(self, payload: MarketDataPayload) -> FeedResponse:
        """
        Store incoming bars and fire off async signal generation.
        Returns immediately — signal generation continues in background.
        """
        sym = payload.symbol.upper()
        async with self._lock:
            if sym not in self._store:
                self._store[sym] = deque(maxlen=500)
            for bar in payload.bars:
                self._store[sym].append(bar)
            self._last_received[sym] = datetime.utcnow()

        asyncio.create_task(self._generate_signal(sym, payload.timeframe))
        asyncio.create_task(self._track_outcomes(sym))

        return FeedResponse(
            status="ok",
            signals_generated=1,
            symbol=sym,
            bars_received=len(payload.bars),
        )

    async def get_latest_signals(
        self,
        symbol: Optional[str] = None,
        signal_type: Optional[SignalType] = None,
    ) -> List[Signal]:
        """Return cached signals, optionally filtered."""
        async with self._lock:
            signals = list(self._signal_cache.values())

        now = datetime.utcnow()
        # Filter out expired signals
        signals = [s for s in signals if s.valid_until > now]

        if symbol:
            signals = [s for s in signals if s.symbol == symbol.upper()]
        if signal_type:
            signals = [s for s in signals if s.signal_type == signal_type]

        return signals

    async def get_signal_for_symbol(self, symbol: str) -> Optional[Signal]:
        sym = symbol.upper()
        async with self._lock:
            sig = self._signal_cache.get(sym)
        if sig and sig.valid_until > datetime.utcnow():
            return sig
        return None

    async def health_info(self) -> dict:
        async with self._lock:
            symbols   = list(self._store.keys())
            counts    = {s: len(self._store[s]) for s in symbols}
            last_recv = {s: self._last_received[s].isoformat() for s in symbols if s in self._last_received}
            active    = sum(
                1 for s in self._signal_cache.values()
                if s.valid_until > datetime.utcnow()
            )
        return {
            "tracked_symbols":   symbols,
            "bar_counts":        counts,
            "last_received":     last_recv,
            "active_signals":    active,
            "tft_cache_symbols": list(self._tft_cache.keys()),
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Internal — signal generation
    # ──────────────────────────────────────────────────────────────────────────

    async def _generate_signal(self, symbol: str, timeframe: str) -> None:
        try:
            async with self._lock:
                bars: List[OHLCVBar] = list(self._store.get(symbol, []))

            if len(bars) < MIN_BARS_FOR_SIGNAL:
                logger.debug(f"[{symbol}] Only {len(bars)} bars — skipping signal generation.")
                return

            df = self._bars_to_df(bars[-ANALYSIS_WINDOW:])
            values = df["close"].to_numpy(dtype=np.float64)
            dates  = df["date"].tolist()
            current_price = float(values[-1])

            # SMC (fast — default executor)
            loop = asyncio.get_event_loop()
            try:
                smc_result = await loop.run_in_executor(
                    None,
                    lambda: SMCEngine(swing_lookback=3).analyze(df),
                )
            except Exception as exc:
                logger.warning(f"[{symbol}] SMC failed: {exc}")
                smc_result = None

            # TFT (slow — cached, dedicated executor)
            tft_result = await self._get_tft_forecast(symbol, values, dates)

            signal = self._compute_signal(
                symbol, timeframe, current_price, df, smc_result, tft_result
            )

            async with self._lock:
                self._signal_cache[symbol] = signal

            logger.info(
                f"[{symbol}] Signal: {signal.signal_type} conf={signal.confidence:.2f} "
                f"RR={signal.risk_reward_ratio:.2f}"
            )

            # Persist to Supabase in the background
            asyncio.create_task(self._persist_signal(signal))

        except Exception as exc:
            logger.error(f"[{symbol}] Signal generation failed: {exc}", exc_info=True)

    async def _get_tft_forecast(
        self, symbol: str, values: np.ndarray, dates: List[str]
    ) -> Optional[dict]:
        """Return cached TFT result or run a new one if stale."""
        now = datetime.utcnow()

        async with self._lock:
            cached = self._tft_cache.get(symbol)

        if cached:
            result, ts = cached
            if (now - ts).total_seconds() < TFT_CACHE_MINUTES * 60:
                logger.debug(f"[{symbol}] Using cached TFT result.")
                return result

        logger.info(f"[{symbol}] Running TFT forecast (this may take 60-120 s on CPU)...")
        loop = asyncio.get_event_loop()
        try:
            forecaster = HybridForecaster(wavelet="db4", wavelet_level=2, garch_p=1, garch_q=1)
            result = await loop.run_in_executor(
                self._tft_executor,
                lambda: forecaster.run_full_pipeline(values, dates, horizon=5),
            )
            async with self._lock:
                self._tft_cache[symbol] = (result, now)
            return result
        except Exception as exc:
            logger.warning(f"[{symbol}] TFT forecast failed: {exc}")
            return None

    # ──────────────────────────────────────────────────────────────────────────
    # Internal — confluence scoring
    # ──────────────────────────────────────────────────────────────────────────

    def _compute_signal(
        self,
        symbol:        str,
        timeframe:     str,
        current_price: float,
        df:            pd.DataFrame,
        smc_result:    Optional[dict],
        tft_result:    Optional[dict],
    ) -> Signal:
        now = datetime.utcnow()

        # ── TFT direction ────────────────────────────────────────────────────
        tft_direction      = "neutral"
        tft_forecast_price = current_price
        tft_available      = False

        if tft_result and not tft_result.get("error"):
            fv = tft_result.get("forecast_values") or []
            if fv:
                tft_available      = True
                tft_forecast_price = float(fv[0]["value"])
                pct = (tft_forecast_price - current_price) / (current_price + 1e-10)
                if pct > 0.001:
                    tft_direction = "bullish"
                elif pct < -0.001:
                    tft_direction = "bearish"

        # ── SMC bias & key levels ────────────────────────────────────────────
        smc_bias          = "neutral"
        nearest_support:  Optional[float] = None
        nearest_resistance: Optional[float] = None
        smc_key_levels: Dict = {"support": [], "resistance": []}

        if smc_result:
            smc_bias = smc_result.get("summary", {}).get("current_bias", "neutral")
            zones = smc_result.get("zones", [])

            demand_zones = sorted(
                [z for z in zones if z["type"] == "demand"
                 and z["strength"] != "broken" and z["top"] < current_price],
                key=lambda z: z["top"], reverse=True,
            )
            supply_zones = sorted(
                [z for z in zones if z["type"] == "supply"
                 and z["strength"] != "broken" and z["bottom"] > current_price],
                key=lambda z: z["bottom"],
            )

            if demand_zones:
                nearest_support = demand_zones[0]["top"]
                smc_key_levels["support"] = [z["top"] for z in demand_zones[:3]]
            if supply_zones:
                nearest_resistance = supply_zones[0]["bottom"]
                smc_key_levels["resistance"] = [z["bottom"] for z in supply_zones[:3]]

        # ── Confidence score (0–1) ───────────────────────────────────────────
        score = 0.0

        # TFT-SMC agreement → +0.3
        if tft_direction != "neutral" and smc_bias != "neutral":
            if tft_direction == smc_bias:
                score += 0.3

        # TFT forecast strength (+0–0.3, maxes out at 2 % price move)
        pct_move = abs(tft_forecast_price - current_price) / (current_price + 1e-10)
        score += min(0.3, pct_move / 0.02 * 0.3)

        # SMC level proximity (+0–0.2, full score within 1 % of a key level)
        if nearest_support is not None and nearest_resistance is not None:
            d_sup = abs(current_price - nearest_support) / current_price
            d_res = abs(nearest_resistance - current_price) / current_price
            min_d = min(d_sup, d_res)
            score += max(0.0, (0.01 - min_d) / 0.01) * 0.2

        # Volume confirmation (+0–0.2)
        if len(df) >= 20:
            avg_vol  = df["volume"].tail(20).mean()
            last_vol = df["volume"].iloc[-1]
            if avg_vol > 0:
                ratio = last_vol / avg_vol
                score += min(0.2, max(0.0, ratio - 1.0) * 0.2)

        score = round(min(1.0, score), 3)

        # ── Determine direction & signal type ────────────────────────────────
        # Prefer explicit direction from either source
        direction = tft_direction if tft_direction != "neutral" else smc_bias
        agree = (tft_direction != "neutral" and smc_bias != "neutral"
                 and tft_direction == smc_bias)

        if agree:
            raw_signal = SignalType.BUY if direction == "bullish" else SignalType.SELL
        elif score >= 0.5 and direction != "neutral":
            raw_signal = SignalType.BUY if direction == "bullish" else SignalType.SELL
        else:
            raw_signal = SignalType.WAIT

        # ── Hybrid ATR + SMC TP/SL ───────────────────────────────────
        atr = self._calculate_atr(df, ATR_PERIOD)
        if atr <= 0:
            atr = current_price * 0.01  # 1% price fallback when < 14 bars available
        buf = current_price * SL_BUFFER_PCT
        max_dist = atr * MAX_ATR_DISTANCE
        sl_source = "atr"
        tp_source = "atr"

        if raw_signal == SignalType.BUY:
            atr_tp = current_price + atr * ATR_TP_MULTIPLIER
            atr_sl = current_price - atr * ATR_SL_MULTIPLIER

            # TP: use SMC resistance if within MAX_ATR_DISTANCE × ATR
            if nearest_resistance is not None and abs(nearest_resistance - current_price) <= max_dist:
                tp = nearest_resistance
                tp_source = "smc"
            else:
                tp = atr_tp

            # SL: use SMC support if within MAX_ATR_DISTANCE × ATR
            if nearest_support is not None and abs(current_price - nearest_support) <= max_dist:
                sl = nearest_support - buf
                sl_source = "smc"
            else:
                sl = atr_sl

        elif raw_signal == SignalType.SELL:
            atr_tp = current_price - atr * ATR_TP_MULTIPLIER
            atr_sl = current_price + atr * ATR_SL_MULTIPLIER

            # TP: use SMC support if within MAX_ATR_DISTANCE × ATR
            if nearest_support is not None and abs(current_price - nearest_support) <= max_dist:
                tp = nearest_support
                tp_source = "smc"
            else:
                tp = atr_tp

            # SL: use SMC resistance if within MAX_ATR_DISTANCE × ATR
            if nearest_resistance is not None and abs(nearest_resistance - current_price) <= max_dist:
                sl = nearest_resistance + buf
                sl_source = "smc"
            else:
                sl = atr_sl

        else:
            tp = current_price + atr * 1.0
            sl = current_price - atr * 1.0

        # ── Risk:Reward gate ─────────────────────────────────────────────────
        risk   = abs(current_price - sl)
        reward = abs(tp - current_price)
        rr     = round(reward / risk, 2) if risk > 0 else 0.0

        if raw_signal != SignalType.WAIT and rr < RR_MINIMUM:
            logger.debug(
                f"[{symbol}] Downgraded to WAIT — RR={rr:.2f} < {RR_MINIMUM}"
            )
            raw_signal = SignalType.WAIT

        return Signal(
            symbol             = symbol,
            signal_type        = raw_signal,
            confidence         = score,
            entry_price        = round(current_price, 5),
            take_profit        = round(tp, 5),
            stop_loss          = round(sl, 5),
            risk_reward_ratio  = rr,
            tft_direction      = tft_direction,
            tft_forecast_price = round(tft_forecast_price, 5),
            smc_bias           = smc_bias,
            smc_key_levels     = smc_key_levels,
            timeframe          = timeframe,
            generated_at       = now,
            valid_until        = now + timedelta(minutes=SIGNAL_VALIDITY_MINUTES),
            metadata           = {
                "tft_available":    tft_available,
                "tft_cached":       bool(self._tft_cache.get(symbol)),
                "bars_analyzed":    len(df),
                "tft_smc_agree":    agree,
                "atr":              round(atr, 5),
                "atr_period":       ATR_PERIOD,
                "sl_source":        sl_source,
                "tp_source":        tp_source,
            },
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Supabase persistence
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    async def _persist_signal(signal: Signal) -> None:
        """Convert Signal → dict and INSERT into Supabase signals_history."""
        record = {
            "symbol":            signal.symbol,
            "signal_type":       signal.signal_type.value,
            "confidence":        signal.confidence,
            "entry_price":       signal.entry_price,
            "take_profit":       signal.take_profit,
            "stop_loss":         signal.stop_loss,
            "risk_reward_ratio": signal.risk_reward_ratio,
            "tft_direction":     signal.tft_direction,
            "smc_bias":          signal.smc_bias,
            "generated_at":      signal.generated_at.isoformat(),
            "valid_until":       signal.valid_until.isoformat(),
            "outcome":           "pending",
            "metadata":          signal.metadata,
        }
        await supabase_client.insert_signal(record)

    async def _track_outcomes(self, symbol: str) -> None:
        """
        Check all 'pending' Supabase rows for `symbol` against the latest
        close price.  Updates outcome to tp_hit / sl_hit / expired.
        Runs as a background task — never blocks ingest.
        """
        try:
            async with self._lock:
                bars = list(self._store.get(symbol, []))
            if not bars:
                return

            current_price = float(bars[-1].close)
            now = datetime.utcnow()

            pending = await supabase_client.fetch_pending_signals()
            pending = [r for r in pending if r.get("symbol") == symbol]

            for row in pending:
                rid         = row.get("id")
                sig_type    = row.get("signal_type", "")
                tp          = row.get("take_profit")
                sl          = row.get("stop_loss")
                valid_until_str = row.get("valid_until", "")

                if not rid or tp is None or sl is None:
                    continue

                # Check expiry first
                try:
                    valid_until = datetime.fromisoformat(valid_until_str.replace("Z", "+00:00"))
                    if valid_until.tzinfo:
                        from datetime import timezone
                        now_aware = now.replace(tzinfo=timezone.utc)
                    else:
                        now_aware = now
                    if now_aware > valid_until.replace(tzinfo=None) if not valid_until.tzinfo else now_aware > valid_until:
                        await supabase_client.update_outcome(rid, "expired", current_price, now.isoformat())
                        continue
                except (ValueError, AttributeError):
                    pass

                outcome = None
                if sig_type == "BUY":
                    if current_price >= tp:
                        outcome = "tp_hit"
                    elif current_price <= sl:
                        outcome = "sl_hit"
                elif sig_type == "SELL":
                    if current_price <= tp:
                        outcome = "tp_hit"
                    elif current_price >= sl:
                        outcome = "sl_hit"

                if outcome:
                    await supabase_client.update_outcome(rid, outcome, current_price, now.isoformat())
                    logger.info(f"[{symbol}] Outcome tracked: {outcome} @ {current_price}")

        except Exception as exc:
            logger.warning(f"[{symbol}] Outcome tracking error: {exc}")

    # ──────────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _calculate_atr(df: pd.DataFrame, period: int = 14) -> float:
        """
        Average True Range over `period` bars.
        Returns 0.0 if fewer than `period` bars are available so the caller
        can apply a percentage-based fallback.
        """
        if len(df) < period:
            return 0.0
        high  = df["high"]
        low   = df["low"]
        close = df["close"]

        tr1 = high - low
        tr2 = (high - close.shift(1)).abs()
        tr3 = (low  - close.shift(1)).abs()

        true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = true_range.rolling(window=period, min_periods=period).mean().iloc[-1]
        return float(atr) if not pd.isna(atr) else 0.0

    @staticmethod
    def _bars_to_df(bars: List[OHLCVBar]) -> pd.DataFrame:
        df = pd.DataFrame([
            {
                "date":   b.timestamp[:10],
                "open":   b.open,
                "high":   b.high,
                "low":    b.low,
                "close":  b.close,
                "volume": b.volume,
            }
            for b in bars
        ])
        return df.reset_index(drop=True)


# Singleton used by the router
signal_service = SignalService()
