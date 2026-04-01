"""
Analytics service layer — thin wrappers over router functions providing a
clean callable API for both HTTP endpoints and the chat tool executor.
"""

from typing import List, Optional
import numpy as np
import pandas as pd

from app.models.schemas import (
    SeriesInput,
    RegressionRequest,
    ForecastRequest,
    ScenarioRequest,
    SeasonalityRequest,
    RiskMetricsRequest,
    DriverShock,
)
from app.routers.analytics import (
    run_regression as _run_regression,
    run_forecast as _run_forecast,
)
from app.routers.scenario import (
    run_scenario as _run_scenario,
    calculate_risk_metrics as _calc_risk,
)
from app.routers.seasonality import run_seasonality as _run_seasonality


# ── Regression ──────────────────────────────────────────────────────────────────


def compute_regression(
    dependent_name: str,
    dependent_dates: List[str],
    dependent_values: List[float],
    independent_name: str,
    independent_dates: List[str],
    independent_values: List[float],
    confidence_level: float = 0.95,
):
    req = RegressionRequest(
        dependent=SeriesInput(name=dependent_name, dates=dependent_dates, values=dependent_values),
        independents=[SeriesInput(name=independent_name, dates=independent_dates, values=independent_values)],
        confidence_level=confidence_level,
    )
    return _run_regression(req)


# ── Forecast ────────────────────────────────────────────────────────────────────


def compute_forecast(
    name: str,
    values: List[float],
    dates: List[str],
    horizon: int = 30,
    models: Optional[List[str]] = None,
    interval: str = "1d",
):
    req = ForecastRequest(
        name=name,
        values=values,
        dates=dates,
        horizon=horizon,
        models=models or ["arima", "ets", "linear"],
        interval=interval,
    )
    return _run_forecast(req)


# ── Scenario ────────────────────────────────────────────────────────────────────


def compute_scenario(
    dataset_name: str,
    current_price: float,
    historical_returns: List[float],
    drivers: Optional[List[DriverShock]] = None,
    horizon_days: int = 90,
    num_simulations: int = 1000,
):
    req = ScenarioRequest(
        dataset_name=dataset_name,
        current_price=current_price,
        historical_returns=historical_returns,
        drivers=drivers or [],
        horizon_days=horizon_days,
        num_simulations=num_simulations,
    )
    return _run_scenario(req)


# ── Seasonality ─────────────────────────────────────────────────────────────────


def compute_seasonality(
    name: str,
    values: List[float],
    dates: List[str],
):
    req = SeasonalityRequest(name=name, dates=dates, values=values)
    return _run_seasonality(req)


# ── Risk metrics ────────────────────────────────────────────────────────────────


def compute_risk_metrics(
    current_price: float,
    historical_returns: List[float],
    historical_prices: List[dict],
    horizon_days: int = 30,
    confidence_levels: Optional[List[float]] = None,
    num_simulations: int = 5000,
):
    req = RiskMetricsRequest(
        current_price=current_price,
        historical_returns=historical_returns,
        historical_prices=historical_prices,
        horizon_days=horizon_days,
        confidence_levels=confidence_levels or [0.95, 0.99],
        num_simulations=num_simulations,
    )
    return _calc_risk(req)


# ── Dataset summary ─────────────────────────────────────────────────────────────


def compute_dataset_summary(name: str, values: List[float], dates: List[str]) -> dict:
    arr = np.array(values, dtype=float)
    rets = np.diff(arr) / arr[:-1]
    total_return = (arr[-1] / arr[0] - 1) * 100 if arr[0] != 0 else 0.0

    series = pd.Series(arr, index=pd.to_datetime(dates))
    last_252 = series.last("252D")

    return {
        "dataset_name": name,
        "num_observations": int(len(arr)),
        "date_range": f"{dates[0]} to {dates[-1]}",
        "current_price": round(float(arr[-1]), 4),
        "previous_close": round(float(arr[-2]), 4) if len(arr) >= 2 else None,
        "last_change_pct": round(float(rets[-1]) * 100, 4) if len(rets) > 0 else None,
        "52w_high": round(float(last_252.max()), 4),
        "52w_low": round(float(last_252.min()), 4),
        "all_time_high": round(float(arr.max()), 4),
        "all_time_low": round(float(arr.min()), 4),
        "mean_price": round(float(arr.mean()), 4),
        "daily_volatility_pct": round(float(rets.std()) * 100, 4),
        "annualised_volatility_pct": round(float(rets.std() * np.sqrt(252)) * 100, 2),
        "total_return_pct": round(float(total_return), 2),
    }
