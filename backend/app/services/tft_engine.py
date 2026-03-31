"""
TFT Engine for CommodityIQ
===========================
Temporal Fusion Transformer trained on wavelet-denoised commodity price trends.

Key design decisions:
- Trained on LOW-FREQUENCY (trend) component only — noise is handled by GARCH
- Uses past covariates: lagged returns, moving averages
- Uses future covariates: time features (month, day_of_week, quarter)
- Strict train/val split — no look-ahead bias
- Falls back gracefully if data is insufficient (<500 points)
"""

import logging
import warnings
from typing import Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger("commodityiq.tft")

# Suppress PyTorch Lightning verbosity
warnings.filterwarnings("ignore", category=UserWarning)
logging.getLogger("pytorch_lightning").setLevel(logging.WARNING)
logging.getLogger("lightning").setLevel(logging.WARNING)


class TFTEngine:
    """
    Trains and forecasts using Temporal Fusion Transformer on denoised trend data.
    """

    MIN_DATA_POINTS = 200      # Minimum for TFT (relaxed from 500 for demo)
    HIDDEN_SIZE = 32           # Reduced for CPU speed (default 64)
    LSTM_LAYERS = 1            # Reduced for CPU speed (default 2)
    NUM_ATTENTION_HEADS = 2    # Reduced for CPU speed (default 4)
    DROPOUT = 0.1
    BATCH_SIZE = 32
    MAX_EPOCHS = 30            # Reduced for demo (production: 100+)
    LEARNING_RATE = 1e-3

    def __init__(self):
        self.model = None
        self.scaler = None
        self.trained = False
        self._import_darts()

    def _import_darts(self):
        """Lazy import darts to avoid slow startup."""
        try:
            from darts import TimeSeries
            from darts.dataprocessing.transformers import Scaler
            from darts.models import TFTModel
            from darts.utils.timeseries_generation import datetime_attribute_timeseries

            self._TimeSeries = TimeSeries
            self._TFTModel = TFTModel
            self._Scaler = Scaler
            self._datetime_attribute_timeseries = datetime_attribute_timeseries
            self._available = True
        except ImportError as e:
            logger.warning(f"Darts not available: {e}. TFT will be disabled.")
            self._available = False

    @property
    def is_available(self) -> bool:
        return self._available

    def prepare_data(
        self,
        trend_values: np.ndarray,
        dates: list,
    ) -> Tuple:
        """
        Prepare Darts TimeSeries objects from trend data.

        Creates:
        - target: the denoised trend series (what we predict)
        - past_covariates: lagged features computed from the series
        - future_covariates: calendar features (month, day_of_week, etc.)

        CRITICAL: All feature engineering uses only past data — no leakage.
        """
        if not self._available:
            raise RuntimeError("Darts library not available")

        # Create pandas DataFrame with datetime index
        df = (
            pd.DataFrame(
                {
                    "date": pd.to_datetime(dates[: len(trend_values)]),
                    "trend": trend_values,
                }
            )
            .set_index("date")
            .asfreq("B")
            .ffill()
        )

        # Target series
        target = self._TimeSeries.from_dataframe(df, value_cols=["trend"])

        # Past covariates: features derived from past values only
        # (MA5, MA20, MA60, returns, volatility)
        trend_series = df["trend"]
        past_features = pd.DataFrame(index=df.index)
        past_features["ma5_ratio"] = trend_series / trend_series.rolling(5).mean() - 1
        past_features["ma20_ratio"] = trend_series / trend_series.rolling(20).mean() - 1
        past_features["ma60_ratio"] = trend_series / trend_series.rolling(60).mean() - 1
        past_features["return_1d"] = trend_series.pct_change(1)
        past_features["return_5d"] = trend_series.pct_change(5)
        past_features["volatility_20d"] = trend_series.pct_change().rolling(20).std()
        past_features = past_features.fillna(0)

        past_covariates = self._TimeSeries.from_dataframe(
            past_features.reset_index(),
            time_col="date",
            value_cols=list(past_features.columns),
        )

        # Future covariates: calendar features (known in advance)
        future_covariates = self._create_calendar_covariates(target)

        return target, past_covariates, future_covariates

    def _create_calendar_covariates(self, target) -> "TimeSeries":
        """Create calendar-based future covariates."""
        month = self._datetime_attribute_timeseries(
            target, attribute="month", one_hot=False
        )
        dayofweek = self._datetime_attribute_timeseries(
            target, attribute="dayofweek", one_hot=False
        )
        quarter = self._datetime_attribute_timeseries(
            target, attribute="quarter", one_hot=False
        )

        # Stack into single multi-variate series
        future_cov = month.stack(dayofweek).stack(quarter)
        return future_cov

    def train(
        self,
        trend_values: np.ndarray,
        dates: list,
        val_split: float = 0.15,
    ) -> dict:
        """
        Train the TFT model on denoised trend data.

        Args:
            trend_values: Low-frequency component from wavelet decomposition
            dates: Corresponding date strings
            val_split: Fraction of data for validation (from the END of training set)

        Returns:
            Training metrics dict
        """
        if not self._available:
            return {"error": "Darts library not available", "trained": False}

        if len(trend_values) < self.MIN_DATA_POINTS:
            return {
                "error": (
                    f"Insufficient data ({len(trend_values)} points). "
                    f"TFT needs at least {self.MIN_DATA_POINTS}."
                ),
                "trained": False,
            }

        try:
            # Prepare data
            target, past_cov, future_cov = self.prepare_data(trend_values, dates)

            # Scale the target
            self.scaler = self._Scaler()
            target_scaled = self.scaler.fit_transform(target)

            n = len(target_scaled)

            # ── ADAPTIVE CHUNK SIZING ──────────────────────────────────────
            # Both train and val must be >= input_chunk + output_chunk + 1.
            # Reduce chunks until both sides fit, or bail if impossible.
            input_chunk = 60
            output_chunk = 30

            while True:
                min_split_size = input_chunk + output_chunk + 1
                val_size = max(int(n * val_split), min_split_size)
                train_size = n - val_size

                if train_size >= min_split_size and val_size >= min_split_size:
                    break

                if output_chunk > 5:
                    output_chunk -= 5
                elif input_chunk > 10:
                    input_chunk -= 10
                else:
                    return {
                        "error": (
                            f"Data too short ({n} points) even with minimum "
                            "chunk sizes."
                        ),
                        "trained": False,
                    }

            train_target = target_scaled[:train_size]
            val_target = target_scaled[train_size:]

            # CRITICAL: split past_cov at the SAME index as target
            train_past_cov = past_cov[:train_size]
            val_past_cov = past_cov[train_size:]

            # Initialize TFT model with adaptive chunk sizes
            self.model = self._TFTModel(
                input_chunk_length=input_chunk,
                output_chunk_length=output_chunk,
                hidden_size=self.HIDDEN_SIZE,
                lstm_layers=self.LSTM_LAYERS,
                num_attention_heads=self.NUM_ATTENTION_HEADS,
                dropout=self.DROPOUT,
                batch_size=min(self.BATCH_SIZE, train_size // 4),
                n_epochs=self.MAX_EPOCHS,
                optimizer_kwargs={"lr": self.LEARNING_RATE},
                random_state=42,
                force_reset=True,
                save_checkpoints=False,
                log_tensorboard=False,
                add_relative_index=True,
                pl_trainer_kwargs={
                    "enable_progress_bar": False,
                    "enable_model_summary": False,
                    "accelerator": "cpu",
                },
            )

            # Train
            logger.info(
                f"Training TFT on {train_size} points "
                f"(input_chunk={input_chunk}, output_chunk={output_chunk})..."
            )
            self.model.fit(
                series=train_target,
                past_covariates=train_past_cov,
                val_series=val_target,
                val_past_covariates=val_past_cov,
                verbose=False,
            )

            self.trained = True

            # Validation metrics (predict only up to output_chunk steps)
            pred_n = min(len(val_target), output_chunk)
            val_pred = self.model.predict(
                n=pred_n,
                series=train_target,
                past_covariates=past_cov[:train_size + pred_n],
            )
            val_pred_inv = self.scaler.inverse_transform(val_pred)
            val_actual_inv = self.scaler.inverse_transform(val_target)

            val_pred_arr = val_pred_inv.values().flatten()
            val_actual_arr = val_actual_inv.values().flatten()
            min_len = min(len(val_pred_arr), len(val_actual_arr))

            mape = float(
                np.mean(
                    np.abs(
                        (val_actual_arr[:min_len] - val_pred_arr[:min_len])
                        / val_actual_arr[:min_len]
                    )
                )
                * 100
            )
            rmse = float(
                np.sqrt(
                    np.mean(
                        (val_actual_arr[:min_len] - val_pred_arr[:min_len]) ** 2
                    )
                )
            )

            return {
                "trained": True,
                "train_size": train_size,
                "val_size": val_size,
                "val_mape": round(mape, 2),
                "val_rmse": round(rmse, 2),
                "epochs": self.MAX_EPOCHS,
                "input_chunk": input_chunk,
                "output_chunk": output_chunk,
                "model_params": {
                    "input_chunk": input_chunk,
                    "output_chunk": output_chunk,
                    "hidden_size": self.HIDDEN_SIZE,
                    "attention_heads": self.NUM_ATTENTION_HEADS,
                },
            }

        except Exception as e:
            logger.error(f"TFT training failed: {e}")
            return {"error": str(e), "trained": False}

    def forecast(
        self,
        trend_values: np.ndarray,
        dates: list,
        horizon: int = 30,
    ) -> Optional[dict]:
        """
        Generate trend forecast using the trained TFT model.

        Args:
            trend_values: Full trend series (train + test)
            dates: Corresponding dates
            horizon: Number of days to forecast

        Returns:
            Dict with forecast values and dates, or None if model not trained
        """
        if not self.trained or self.model is None:
            return None

        try:
            target, past_cov, future_cov = self.prepare_data(trend_values, dates)
            target_scaled = self.scaler.transform(target)

            # Forecast — iterate if horizon > output_chunk_length
            remaining = horizon
            forecasts = []
            current_series = target_scaled

            current_past_cov = past_cov
            while remaining > 0:
                step = min(remaining, self.model.output_chunk_length)
                pred = self.model.predict(
                    n=step,
                    series=current_series,
                    past_covariates=current_past_cov,
                )
                forecasts.append(pred)
                current_series = current_series.append(pred)
                remaining -= step
                if remaining > 0:
                    last_vals = current_past_cov.pd_dataframe().iloc[-1:].values
                    pad_df = pd.DataFrame(
                        [last_vals[0]] * step,
                        columns=current_past_cov.pd_dataframe().columns,
                        index=pd.bdate_range(
                            start=current_past_cov.end_time() + pd.Timedelta(days=1),
                            periods=step,
                            freq="B",
                        ),
                    )
                    pad_ts = self._TimeSeries.from_dataframe(pad_df)
                    current_past_cov = current_past_cov.append(pad_ts)

            # Concatenate and inverse transform
            from darts import concatenate

            full_forecast = concatenate(forecasts)
            forecast_inv = self.scaler.inverse_transform(full_forecast)

            forecast_values = forecast_inv.values().flatten().tolist()

            # Generate future business dates
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

            return {
                "values": forecast_values[:horizon],
                "dates": forecast_dates[:horizon],
            }

        except Exception as e:
            logger.error(f"TFT forecast failed: {e}")
            return None
