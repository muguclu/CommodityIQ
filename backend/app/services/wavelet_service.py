"""
Wavelet Transform Service for CommodityIQ
==========================================
Decomposes commodity price series into:
- Low-frequency component (trend/signal) → for TFT forecasting
- High-frequency component (noise/volatility) → for GARCH modelling

Uses Discrete Wavelet Transform (DWT) with strict look-ahead bias prevention.
"""

import numpy as np
import pywt
from typing import Tuple


class WaveletDecomposer:
    """
    Decomposes a time series using DWT with sliding window approach
    to prevent look-ahead bias.
    """

    def __init__(self, wavelet: str = "db4", level: int = 2):
        """
        Args:
            wavelet: Wavelet family to use. 'db4' (Daubechies-4) is ideal for
                     financial time series — good time-frequency localization.
                     Alternatives: 'db6', 'sym5', 'coif3'
            level: Decomposition level.
                   Level 2 gives: cA2 (trend), cD2+cD1 (noise layers)
                   Higher level = smoother trend but more lag.
                   For daily commodity data: level=2 is optimal.
        """
        self.wavelet = wavelet
        self.level = level
        self._validate_wavelet()

    def _validate_wavelet(self):
        """Verify the wavelet name is valid."""
        if self.wavelet not in pywt.wavelist():
            raise ValueError(
                f"Unknown wavelet '{self.wavelet}'. "
                f"Use one of: {pywt.wavelist()[:10]}..."
            )

    def decompose(self, values: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Decompose a price series into trend and noise components.

        CRITICAL: This method applies DWT to the ENTIRE input array.
        For training, only pass training data. For inference, use
        decompose_online() with sliding window to avoid look-ahead bias.

        Args:
            values: 1D numpy array of prices

        Returns:
            trend: Low-frequency component (approximation coefficients reconstructed)
            noise: High-frequency component (detail coefficients reconstructed)
        """
        min_len = 2 ** (self.level + 1)
        if len(values) < min_len:
            raise ValueError(
                f"Series too short ({len(values)}) for {self.level}-level decomposition. "
                f"Need at least {min_len} points."
            )

        # Perform multi-level DWT decomposition
        coeffs = pywt.wavedec(values, self.wavelet, level=self.level)
        # coeffs = [cA_n, cD_n, cD_n-1, ..., cD_1]
        # cA_n = approximation (trend), cD_* = details (noise layers)

        # Reconstruct TREND: keep only approximation, zero out details
        trend_coeffs = [coeffs[0]] + [np.zeros_like(c) for c in coeffs[1:]]
        trend = pywt.waverec(trend_coeffs, self.wavelet)[: len(values)]

        # Reconstruct NOISE: original minus trend
        noise = values - trend

        return trend.astype(np.float64), noise.astype(np.float64)

    def decompose_online(
        self, values: np.ndarray, window_size: int = 252
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Online (sliding window) decomposition to prevent look-ahead bias.

        For each point t, applies DWT only to values[max(0, t-window_size):t+1].
        This is slower but guarantees no future data leakage.

        Use this for TEST SET decomposition.

        Args:
            values: Full price series
            window_size: Lookback window for DWT (default 252 = ~1 year)

        Returns:
            trend: Low-frequency component (same length as input)
            noise: High-frequency component (same length as input)
        """
        n = len(values)
        trend = np.zeros(n)
        noise = np.zeros(n)

        min_length = 2 ** (self.level + 1)

        for t in range(n):
            start = max(0, t - window_size + 1)
            window = values[start : t + 1]

            if len(window) < min_length:
                # Not enough data for DWT — use raw value
                trend[t] = values[t]
                noise[t] = 0.0
            else:
                # DWT on the window — take only the LAST value
                w_trend, w_noise = self.decompose(window)
                trend[t] = w_trend[-1]
                noise[t] = w_noise[-1]

        return trend, noise

    def reconstruct(self, trend: np.ndarray, noise: np.ndarray) -> np.ndarray:
        """
        Reconstruct the original signal from trend + noise.
        This is a simple addition — the IDWT is implicit in the
        decompose step (we already have time-domain components).

        Args:
            trend: Low-frequency forecast from TFT
            noise: High-frequency forecast from GARCH

        Returns:
            Reconstructed price forecast
        """
        return trend + noise

    def get_decomposition_stats(self, values: np.ndarray) -> dict:
        """
        Returns statistics about the decomposition quality.
        """
        trend, noise = self.decompose(values)

        # Signal-to-noise ratio
        signal_power = np.var(trend)
        noise_power = np.var(noise)
        snr_db = (
            10 * np.log10(signal_power / noise_power)
            if noise_power > 0
            else float("inf")
        )

        # Trend smoothness (lower = smoother)
        trend_roughness = np.mean(np.abs(np.diff(trend, 2))) / np.mean(np.abs(trend))

        # Noise normality test (GARCH assumes ~normal residuals)
        from scipy import stats

        _, noise_normality_p = (
            stats.normaltest(noise) if len(noise) > 20 else (0, 1)
        )

        return {
            "snr_db": round(float(snr_db), 2),
            "signal_power": round(float(signal_power), 4),
            "noise_power": round(float(noise_power), 4),
            "noise_std": round(float(np.std(noise)), 4),
            "noise_mean": round(float(np.mean(noise)), 6),
            "trend_roughness": round(float(trend_roughness), 6),
            "noise_normality_p": round(float(noise_normality_p), 4),
            "wavelet": self.wavelet,
            "level": self.level,
            "data_points": len(values),
        }
