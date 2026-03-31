"""
GARCH Engine for CommodityIQ
=============================
Models the HIGH-FREQUENCY (noise) component from wavelet decomposition
using GARCH(1,1). Produces volatility forecasts for dynamic confidence bands.

Why GARCH for the noise component:
- Commodity market noise shows volatility clustering (ARCH effects)
- Standard deviation is NOT constant — it expands during crises and contracts during calm
- GARCH captures this heteroskedasticity → dynamic CI bands instead of static ones
"""

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger("commodityiq.garch")


class GARCHEngine:
    """
    Fits GARCH(p,q) to the noise component and forecasts conditional variance.
    """

    def __init__(self, p: int = 1, q: int = 1):
        """
        Args:
            p: GARCH lag order (number of lagged variance terms). Default 1.
            q: ARCH lag order (number of lagged squared residual terms). Default 1.
        """
        self.p = p
        self.q = q
        self.model_result = None
        self.fitted = False
        self.noise_scale: float = 1.0
        self._check_availability()

    def _check_availability(self):
        try:
            from arch import arch_model

            self._arch_model = arch_model
            self._available = True
        except ImportError:
            logger.warning("arch library not available. GARCH will be disabled.")
            self._available = False

    @property
    def is_available(self) -> bool:
        return self._available

    def fit(self, noise: np.ndarray) -> dict:
        """
        Fit GARCH(p,q) to the noise component.

        Args:
            noise: High-frequency component from wavelet decomposition.
                   Should be the TRAINING portion only.

        Returns:
            Fit summary dict with parameters and diagnostics.
        """
        if not self._available:
            return {"error": "arch library not available", "fitted": False}

        if len(noise) < 50:
            return {
                "error": f"Insufficient data ({len(noise)} points). GARCH needs at least 50.",
                "fitted": False,
            }

        try:
            # Scale noise to returns-like magnitude for GARCH stability
            self.noise_scale = float(np.std(noise)) if np.std(noise) > 0 else 1.0
            scaled_noise = (noise / self.noise_scale) * 100  # Scale to percentage

            model = self._arch_model(
                scaled_noise,
                vol="Garch",
                p=self.p,
                q=self.q,
                dist="normal",
                rescale=False,
            )

            self.model_result = model.fit(
                disp="off",
                show_warning=False,
            )

            self.fitted = True

            params = self.model_result.params

            return {
                "fitted": True,
                "parameters": {
                    "omega": float(params.get("omega", 0)),
                    "alpha": float(params.get("alpha[1]", 0)),
                    "beta": float(params.get("beta[1]", 0)),
                    "persistence": float(
                        params.get("alpha[1]", 0) + params.get("beta[1]", 0)
                    ),
                },
                "aic": float(self.model_result.aic),
                "bic": float(self.model_result.bic),
                "log_likelihood": float(self.model_result.loglikelihood),
                "num_observations": int(self.model_result.nobs),
                "noise_scale": float(self.noise_scale),
                "conditional_volatility_latest": float(
                    self.model_result.conditional_volatility[-1]
                    * self.noise_scale
                    / 100
                ),
            }

        except Exception as e:
            logger.error(f"GARCH fitting failed: {e}")
            return {"error": str(e), "fitted": False}

    def forecast_volatility(self, horizon: int = 30) -> Optional[dict]:
        """
        Forecast conditional variance (volatility) for the next `horizon` periods.

        The output is the expected STANDARD DEVIATION of the noise at each future step.
        This is used to create dynamic confidence bands around the TFT trend forecast.

        Args:
            horizon: Number of periods to forecast

        Returns:
            Dict with volatility forecast and related statistics
        """
        if not self.fitted or self.model_result is None:
            return None

        try:
            forecast = self.model_result.forecast(horizon=horizon, reindex=False)

            # Last row = forecast from the latest observation
            variance_forecast = forecast.variance.values[-1, :]
            std_forecast = np.sqrt(variance_forecast) * self.noise_scale / 100

            mean_forecast = forecast.mean.values[-1, :]
            mean_forecast_rescaled = mean_forecast * self.noise_scale / 100

            return {
                "volatility": std_forecast.tolist(),
                "variance": (
                    variance_forecast * (self.noise_scale / 100) ** 2
                ).tolist(),
                "mean_noise": mean_forecast_rescaled.tolist(),
                "horizon": horizon,
                "current_volatility": float(std_forecast[0]),
                "terminal_volatility": float(std_forecast[-1]),
                "avg_volatility": float(np.mean(std_forecast)),
                "max_volatility": float(np.max(std_forecast)),
                "volatility_trend": (
                    "increasing"
                    if std_forecast[-1] > std_forecast[0] * 1.05
                    else "decreasing"
                    if std_forecast[-1] < std_forecast[0] * 0.95
                    else "stable"
                ),
            }

        except Exception as e:
            logger.error(f"GARCH forecast failed: {e}")
            return None

    def get_current_regime(self) -> Optional[str]:
        """
        Classify current volatility regime based on historical percentiles.
        """
        if not self.fitted:
            return None

        cond_vol = np.asarray(self.model_result.conditional_volatility)
        current = cond_vol[-1]
        p25 = np.percentile(cond_vol, 25)
        p75 = np.percentile(cond_vol, 75)

        if current < p25:
            return "low"
        elif current > p75:
            return "high"
        else:
            return "normal"
