"""
Hybrid Forecast Service for CommodityIQ
=========================================
Orchestrates the full Wavelet-TFT-GARCH pipeline:
1. Wavelet decomposition → trend + noise
2. TFT forecast on trend
3. GARCH forecast on noise volatility
4. Reconstruction: trend_forecast + GARCH-adjusted confidence bands

The key insight: CI bands are NOT static ± values.
They EXPAND when GARCH predicts increasing volatility and
CONTRACT when GARCH predicts calm markets.
"""

import logging

import numpy as np
from scipy import stats as scipy_stats

from .garch_engine import GARCHEngine
from .tft_engine import TFTEngine
from .wavelet_service import WaveletDecomposer

logger = logging.getLogger("commodityiq.hybrid")


class HybridForecaster:
    """
    Full pipeline: DWT → TFT + GARCH → IDWT reconstruction
    """

    def __init__(
        self,
        wavelet: str = "db4",
        wavelet_level: int = 2,
        garch_p: int = 1,
        garch_q: int = 1,
    ):
        self.decomposer = WaveletDecomposer(wavelet=wavelet, level=wavelet_level)
        self.tft_engine = TFTEngine()
        self.garch_engine = GARCHEngine(p=garch_p, q=garch_q)

    def run_full_pipeline(
        self,
        values: np.ndarray,
        dates: list,
        horizon: int = 30,
        confidence_level: float = 0.95,
        train_test_split: float = 0.8,
    ) -> dict:
        """
        Execute the complete hybrid forecast pipeline.

        Args:
            values: Raw commodity close prices
            dates: Corresponding date strings
            horizon: Forecast horizon in days
            confidence_level: For CI bands (0.90, 0.95, 0.99)
            train_test_split: Fraction for training

        Returns:
            Complete forecast result dict compatible with the existing ForecastResult schema
        """
        result = {
            "model_name": "hybrid_tft",
            "display_name": "Hybrid TFT + Wavelet + GARCH",
            "parameters": {},
            "forecast_values": [],
            "backtest": None,
            "aic": None,
            "bic": None,
            "error": None,
            "decomposition_stats": None,
            "garch_params": None,
            "tft_metrics": None,
            "signal_health": None,
        }

        try:
            values = np.array(values, dtype=np.float64)
            n = len(values)
            split_idx = int(n * train_test_split)

            train_values = values[:split_idx]
            test_values = values[split_idx:]
            train_dates = dates[:split_idx]
            test_dates = dates[split_idx:]

            # ═══════════════════════════════════════
            # STEP 1: Wavelet Decomposition (TRAIN ONLY)
            # ═══════════════════════════════════════
            logger.info("Step 1: Wavelet decomposition...")
            train_trend, train_noise = self.decomposer.decompose(train_values)
            decomp_stats = self.decomposer.get_decomposition_stats(train_values)
            result["decomposition_stats"] = decomp_stats

            # For test set: use ONLINE decomposition (sliding window, no look-ahead)
            full_trend, full_noise = self.decomposer.decompose_online(
                values, window_size=252
            )

            # ═══════════════════════════════════════
            # STEP 2: TFT Training + Forecast on TREND
            # ═══════════════════════════════════════
            logger.info("Step 2: Training TFT on denoised trend...")

            tft_available = self.tft_engine.is_available
            tft_trend_forecast = None

            if tft_available:
                tft_train_result = self.tft_engine.train(
                    trend_values=train_trend,
                    dates=train_dates,
                    val_split=0.1,
                )
                result["tft_metrics"] = tft_train_result

                if tft_train_result.get("trained"):
                    tft_trend_forecast = self.tft_engine.forecast(
                        trend_values=full_trend,
                        dates=dates,
                        horizon=horizon,
                    )
                    result["parameters"]["tft_order"] = str(
                        tft_train_result.get("model_params", {})
                    )

            # Fallback: linear extrapolation of trend
            if tft_trend_forecast is None:
                logger.warning(
                    "TFT unavailable or failed — falling back to linear trend extrapolation"
                )
                from scipy.stats import linregress

                import pandas as pd

                x = np.arange(len(full_trend))
                slope, intercept, _, _, _ = linregress(
                    x[-60:], full_trend[-60:]
                )
                x_future = np.arange(
                    len(full_trend), len(full_trend) + horizon
                )
                trend_forecast_values = (slope * x_future + intercept).tolist()

                last_date = pd.to_datetime(dates[-1])
                forecast_dates = (
                    pd.bdate_range(
                        start=last_date + pd.Timedelta(days=1),
                        periods=horizon,
                        freq="B",
                    )
                    .strftime("%Y-%m-%d")
                    .tolist()
                )

                tft_trend_forecast = {
                    "values": trend_forecast_values,
                    "dates": forecast_dates,
                }
                result["parameters"]["tft_fallback"] = "linear_extrapolation"

            # ═══════════════════════════════════════
            # STEP 3: GARCH on NOISE component
            # ═══════════════════════════════════════
            logger.info("Step 3: Fitting GARCH on noise component...")

            garch_result = self.garch_engine.fit(train_noise)
            result["garch_params"] = garch_result

            garch_vol_forecast = None
            if garch_result.get("fitted"):
                garch_vol_forecast = self.garch_engine.forecast_volatility(
                    horizon=horizon
                )
                result["parameters"]["garch_persistence"] = garch_result[
                    "parameters"
                ]["persistence"]

            # ═══════════════════════════════════════
            # STEP 4: Reconstruction + Dynamic CI Bands
            # ═══════════════════════════════════════
            logger.info("Step 4: Reconstructing hybrid forecast...")

            trend_forecast = np.array(tft_trend_forecast["values"])
            forecast_dates = tft_trend_forecast["dates"]

            if garch_vol_forecast and garch_vol_forecast.get("mean_noise"):
                noise_forecast = np.array(garch_vol_forecast["mean_noise"])
            else:
                noise_forecast = np.zeros(horizon)

            final_forecast = self.decomposer.reconstruct(
                trend_forecast, noise_forecast
            )

            z = scipy_stats.norm.ppf((1 + confidence_level) / 2)

            if garch_vol_forecast and garch_vol_forecast.get("volatility"):
                dynamic_std = np.array(garch_vol_forecast["volatility"])
            else:
                dynamic_std = np.full(horizon, float(np.std(train_noise)))

            ci_lower = final_forecast - z * dynamic_std
            ci_upper = final_forecast + z * dynamic_std

            forecast_points = []
            for i in range(horizon):
                forecast_points.append(
                    {
                        "date": forecast_dates[i],
                        "value": round(float(final_forecast[i]), 2),
                        "ci_lower": round(float(ci_lower[i]), 2),
                        "ci_upper": round(float(ci_upper[i]), 2),
                        "trend_component": round(float(trend_forecast[i]), 2),
                        "noise_std": round(float(dynamic_std[i]), 4),
                    }
                )

            result["forecast_values"] = forecast_points

            # ═══════════════════════════════════════
            # STEP 5: Backtest on test set
            # ═══════════════════════════════════════
            if len(test_values) > 0:
                logger.info("Step 5: Backtesting...")

                backtest_forecast = full_trend[
                    split_idx : split_idx + len(test_values)
                ]
                backtest_reconstructed = backtest_forecast + float(
                    np.mean(train_noise)
                )

                actual = test_values[: len(backtest_reconstructed)]
                predicted = backtest_reconstructed[: len(actual)]

                mape = float(
                    np.mean(np.abs((actual - predicted) / actual)) * 100
                )
                rmse = float(np.sqrt(np.mean((actual - predicted) ** 2)))
                mae = float(np.mean(np.abs(actual - predicted)))

                naive_forecast = values[
                    split_idx - 1 : split_idx - 1 + len(actual)
                ]
                naive_rmse = float(
                    np.sqrt(np.mean((actual - naive_forecast) ** 2))
                )
                theils_u = rmse / naive_rmse if naive_rmse > 0 else float("inf")

                result["backtest"] = {
                    "actual": [
                        {"date": test_dates[i], "value": float(actual[i])}
                        for i in range(len(actual))
                    ],
                    "predicted": [
                        {"date": test_dates[i], "value": float(predicted[i])}
                        for i in range(len(predicted))
                    ],
                    "metrics": {
                        "mape": round(mape, 2),
                        "rmse": round(rmse, 2),
                        "mae": round(mae, 2),
                        "theils_u": round(float(theils_u), 4),
                    },
                }

            # ═══════════════════════════════════════
            # Signal Health summary
            # ═══════════════════════════════════════
            result["signal_health"] = {
                "snr_db": decomp_stats["snr_db"],
                "noise_normality": (
                    "normal"
                    if decomp_stats["noise_normality_p"] > 0.05
                    else "non-normal"
                ),
                "garch_persistence": garch_result.get("parameters", {}).get(
                    "persistence", None
                ),
                "volatility_regime": self.garch_engine.get_current_regime(),
                "tft_available": tft_available,
                "tft_trained": (
                    result.get("tft_metrics") or {}
                ).get("trained", False),
                "ci_type": (
                    "dynamic_garch" if garch_vol_forecast else "static_historical"
                ),
            }

            if garch_result.get("fitted"):
                result["aic"] = garch_result.get("aic")
                result["bic"] = garch_result.get("bic")

            # ═══════════════════════════════════════
            # Historical decomposition for frontend visualization
            # ═══════════════════════════════════════
            window = min(252, n)
            window_start = n - window
            hist_dates = [str(d) for d in dates[window_start:]]
            hist_original = [round(float(v), 2) for v in values[window_start:]]
            hist_trend = [round(float(v), 2) for v in full_trend[window_start:]]
            hist_noise = [round(float(v), 4) for v in full_noise[window_start:]]

            hist_garch_vol: list = [None] * window
            if garch_result.get("fitted") and self.garch_engine.model_result is not None:
                cond_vol = np.asarray(
                    self.garch_engine.model_result.conditional_volatility
                )
                full_garch: list = [None] * n
                for idx_g, v in enumerate(cond_vol):
                    if idx_g < n:
                        full_garch[idx_g] = round(float(v), 4)
                hist_garch_vol = full_garch[window_start:]

            result["historical_decomposition"] = {
                "dates": hist_dates,
                "original": hist_original,
                "trend": hist_trend,
                "noise": hist_noise,
                "garch_vol": hist_garch_vol,
            }

            logger.info("Hybrid forecast pipeline complete.")
            return result

        except Exception as e:
            logger.error(f"Hybrid pipeline failed: {e}")
            result["error"] = str(e)
            return result
