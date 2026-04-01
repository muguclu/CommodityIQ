from typing import List, Optional
import warnings
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from app.services.hybrid_forecast import HybridForecaster
from app.services.smc_engine import SMCEngine

import numpy as np
import statsmodels.api as sm
from fastapi import APIRouter, HTTPException
from scipy import stats as scipy_stats
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.stattools import durbin_watson, jarque_bera
from statsmodels.tsa.holtwinters import ExponentialSmoothing

import pandas as pd
from scipy.stats import f as f_dist
from statsmodels.stats.diagnostic import recursive_olsresiduals

from app.models.schemas import (
    BacktestMetrics,
    BacktestResult,
    CoefficientDetail,
    ForecastPoint,
    ForecastRequest,
    ForecastResult,
    ModelForecast,
    RegressionRequest,
    RegressionResult,
    RollingRegressionRequest,
    RollingRegressionResult,
    RollingWindow,
    RollingWindowPoint,
    SeriesInput,
    StepwiseRequest,
    StepwiseResult,
    StepwiseStep,
    StructuralBreakRequest,
    StructuralBreakResult,
    SMCRequest,
)

router = APIRouter(tags=["analytics"])

_arima_executor = ThreadPoolExecutor(max_workers=2)
MAX_ARIMA_POINTS = 500
ARIMA_TIMEOUT_SECONDS = 45

_tft_executor = ThreadPoolExecutor(max_workers=1)
TFT_TIMEOUT_SECONDS = 120


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _align_series(dependent: SeriesInput, independents: List[SeriesInput]):
    """Inner-join all series by date. Returns (dates, y, X_cols)."""
    dep_map = {d: v for d, v in zip(dependent.dates, dependent.values)}
    ind_maps = [
        {d: v for d, v in zip(s.dates, s.values)} for s in independents
    ]

    common_dates = sorted(
        set(dep_map.keys()).intersection(*[set(m.keys()) for m in ind_maps])
    )

    rows = []
    for date in common_dates:
        yv = dep_map[date]
        xvs = [m[date] for m in ind_maps]
        if yv != yv or any(v != v for v in xvs):  # NaN check
            continue
        rows.append((date, yv, xvs))

    return rows


def _build_regression_result(
    dependent: SeriesInput,
    independents: List[SeriesInput],
    confidence_level: float,
) -> RegressionResult:
    rows = _align_series(dependent, independents)

    if len(rows) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient overlapping data: only {len(rows)} matching dates (minimum 10 required).",
        )

    dates_aligned = [r[0] for r in rows]
    y = np.array([r[1] for r in rows], dtype=float)
    X_cols = np.column_stack([np.array([r[2][i] for r in rows], dtype=float)
                              for i in range(len(independents))])

    if np.std(y) == 0:
        raise HTTPException(status_code=400, detail="No variance in dependent variable data.")
    for i, s in enumerate(independents):
        col = X_cols[:, i] if X_cols.ndim > 1 else X_cols
        if np.std(col) == 0:
            raise HTTPException(status_code=400, detail=f"No variance in '{s.name}'.")

    alpha = 1.0 - confidence_level
    X_with_const = sm.add_constant(X_cols)

    try:
        model = sm.OLS(y, X_with_const).fit()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Regression failed: {exc}") from exc

    conf_int = model.conf_int(alpha=alpha)
    predicted = model.fittedvalues
    residuals_vals = model.resid

    # ── Coefficients ──────────────────────────────────────────────────────────
    coef_names = ["Intercept"] + [s.name for s in independents]
    coefficients = [
        CoefficientDetail(
            name=coef_names[i],
            value=float(model.params[i]),
            std_error=float(model.bse[i]),
            t_statistic=float(model.tvalues[i]),
            p_value=float(model.pvalues[i]),
            ci_lower=float(conf_int[i][0]),
            ci_upper=float(conf_int[i][1]),
        )
        for i in range(len(model.params))
    ]

    # ── Residuals ────────────────────────────────────────────────────────────
    residuals = [
        {
            "date": dates_aligned[i],
            "value": float(y[i]),
            "predicted": float(predicted[i]),
            "residual": float(residuals_vals[i]),
        }
        for i in range(len(rows))
    ]

    # ── Actual vs Predicted ──────────────────────────────────────────────────
    actual_vs_predicted = [
        {"date": dates_aligned[i], "actual": float(y[i]), "predicted": float(predicted[i])}
        for i in range(len(rows))
    ]

    # ── Simple (1 var) extras ────────────────────────────────────────────────
    scatter_data: list = []
    regression_line: dict = {}
    confidence_band: list = []

    if len(independents) == 1:
        x1 = X_cols[:, 0] if X_cols.ndim > 1 else X_cols
        scatter_data = [
            {"x": float(x1[i]), "y": float(y[i]), "date": dates_aligned[i]}
            for i in range(len(rows))
        ]
        x_min, x_max = float(x1.min()), float(x1.max())
        intercept_val = float(model.params[0])
        slope_val = float(model.params[1])
        regression_line = {
            "x_min": x_min, "x_max": x_max,
            "y_min": intercept_val + slope_val * x_min,
            "y_max": intercept_val + slope_val * x_max,
        }
        try:
            x_band = np.linspace(x_min, x_max, 50)
            X_band = sm.add_constant(x_band)
            pred_frame = model.get_prediction(X_band).summary_frame(alpha=alpha)
            confidence_band = [
                {
                    "x": float(x_band[i]),
                    "y_lower": float(pred_frame["mean_ci_lower"].iloc[i]),
                    "y_upper": float(pred_frame["mean_ci_upper"].iloc[i]),
                }
                for i in range(len(x_band))
            ]
        except Exception:
            confidence_band = []

    # ── Partial regression plots ─────────────────────────────────────────────
    partial_regression_data: list = []
    n_ind = len(independents)
    if n_ind > 1:
        for j in range(n_ind):
            other_cols = [k for k in range(n_ind) if k != j]
            X_other = np.column_stack(
                [X_cols[:, k] for k in other_cols]
            ) if len(other_cols) > 1 else X_cols[:, other_cols[0]].reshape(-1, 1)
            X_other_c = sm.add_constant(X_other)

            res_y = sm.OLS(y, X_other_c).fit().resid
            res_xj = sm.OLS(X_cols[:, j], X_other_c).fit().resid
            partial_regression_data.append({
                "name": independents[j].name,
                "data": [
                    {"x_partial": float(res_xj[i]), "y_partial": float(res_y[i])}
                    for i in range(len(rows))
                ],
            })

    # ── VIF ──────────────────────────────────────────────────────────────────
    vif_scores: list = []
    if n_ind > 1:
        try:
            for j in range(n_ind):
                vif_val = variance_inflation_factor(X_with_const, j + 1)
                vif_scores.append({"name": independents[j].name, "vif": float(vif_val)})
        except Exception:
            vif_scores = [{"name": s.name, "vif": 1.0} for s in independents]
    else:
        vif_scores = [{"name": independents[0].name, "vif": 1.0}]

    # ── Correlation matrix ───────────────────────────────────────────────────
    all_names = [dependent.name] + [s.name for s in independents]
    all_cols = np.column_stack([y, X_cols]) if n_ind > 1 else np.column_stack([y, X_cols])
    corr_matrix = np.corrcoef(all_cols.T)
    correlation_matrix = {
        "columns": all_names,
        "values": [[float(v) for v in row] for row in corr_matrix],
    }

    # ── Partial F-tests ──────────────────────────────────────────────────────
    partial_f_tests = None
    if n_ind > 1:
        partial_f_tests = []
        for j in range(n_ind):
            remaining = [k for k in range(n_ind) if k != j]
            if len(remaining) == 0:
                continue
            X_reduced = sm.add_constant(
                np.column_stack([X_cols[:, k] for k in remaining])
                if len(remaining) > 1 else X_cols[:, remaining[0]]
            )
            model_reduced = sm.OLS(y, X_reduced).fit()
            n = len(y)
            k_full = n_ind + 1
            k_red = len(remaining) + 1
            rss_full = float(model.ssr)
            rss_red = float(model_reduced.ssr)
            f_stat = ((rss_red - rss_full) / 1) / (rss_full / (n - k_full))
            from scipy import stats as scipy_stats
            p_val = float(1 - scipy_stats.f.cdf(f_stat, 1, n - k_full))
            partial_f_tests.append({
                "variable": independents[j].name,
                "f_stat": float(f_stat),
                "p_value": p_val,
            })

    # ── Diagnostics ──────────────────────────────────────────────────────────
    dw = float(durbin_watson(residuals_vals))
    try:
        jb_stat, jb_pval, _, _ = jarque_bera(residuals_vals)
        jb = {"statistic": float(jb_stat), "p_value": float(jb_pval)}
    except Exception:
        jb = {"statistic": 0.0, "p_value": 1.0}

    return RegressionResult(
        r_squared=float(model.rsquared),
        adj_r_squared=float(model.rsquared_adj),
        f_statistic=float(model.fvalue),
        f_pvalue=float(model.f_pvalue),
        num_observations=int(model.nobs),
        coefficients=coefficients,
        scatter_data=scatter_data,
        regression_line=regression_line,
        confidence_band=confidence_band,
        actual_vs_predicted=actual_vs_predicted,
        partial_regression_data=partial_regression_data,
        residuals=residuals,
        durbin_watson=dw,
        jarque_bera=jb,
        dependent_name=dependent.name,
        independent_names=[s.name for s in independents],
        vif_scores=vif_scores,
        correlation_matrix=correlation_matrix,
        partial_f_tests=partial_f_tests,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/regression", response_model=RegressionResult)
def run_regression(req: RegressionRequest) -> RegressionResult:
    if not req.independents:
        raise HTTPException(status_code=400, detail="At least one independent variable is required.")
    return _build_regression_result(req.dependent, req.independents, req.confidence_level)


@router.post("/regression/stepwise", response_model=StepwiseResult)
def run_stepwise(req: StepwiseRequest) -> StepwiseResult:
    if not req.candidates:
        raise HTTPException(status_code=400, detail="At least one candidate variable is required.")

    dep_map = {d: v for d, v in zip(req.dependent.dates, req.dependent.values)}

    # Pre-filter candidates: must have >= 10 overlapping dates with dependent
    valid_candidates: List[SeriesInput] = []
    for c in req.candidates:
        ind_map = {d: v for d, v in zip(c.dates, c.values)}
        common = set(dep_map.keys()) & set(ind_map.keys())
        if len(common) >= 10:
            valid_candidates.append(c)

    if not valid_candidates:
        raise HTTPException(status_code=400, detail="No candidates have sufficient overlapping data with the dependent variable.")

    # Forward selection
    selected: List[SeriesInput] = []
    remaining: List[SeriesInput] = list(valid_candidates)
    steps: List[StepwiseStep] = []
    excluded_reasons: dict = {}

    step_num = 0
    while remaining:
        best_pval = req.p_enter
        best_var: SeriesInput | None = None
        best_model_info: dict = {}

        for candidate in remaining:
            trial = selected + [candidate]
            rows = _align_series(req.dependent, trial)
            if len(rows) < 10:
                continue
            y_t = np.array([r[1] for r in rows], dtype=float)
            X_t = np.column_stack(
                [np.array([r[2][i] for r in rows], dtype=float) for i in range(len(trial))]
            ) if len(trial) > 1 else np.array([r[2][0] for r in rows], dtype=float)
            try:
                m = sm.OLS(y_t, sm.add_constant(X_t)).fit()
            except Exception:
                continue
            # p-value of the new variable (last coefficient)
            p_new = float(m.pvalues[-1])
            if p_new < best_pval:
                best_pval = p_new
                best_var = candidate
                best_model_info = {
                    "r_squared": float(m.rsquared),
                    "aic": float(m.aic),
                    "p_value": p_new,
                }

        if best_var is None:
            break

        step_num += 1
        selected.append(best_var)
        remaining.remove(best_var)
        steps.append(StepwiseStep(
            step=step_num,
            action="add",
            variable=best_var.name,
            r_squared=best_model_info["r_squared"],
            aic=best_model_info["aic"],
            p_value=best_model_info["p_value"],
        ))

    # Any remaining candidates are excluded
    excluded_variables = [c.name for c in remaining]
    for c in remaining:
        excluded_reasons[c.name] = f"Not significant (p > {req.p_enter})"

    if not selected:
        raise HTTPException(status_code=400, detail="No variables met the significance threshold for entry.")

    final_model = _build_regression_result(req.dependent, selected, 0.95)

    return StepwiseResult(
        steps=steps,
        final_model=final_model,
        excluded_variables=excluded_variables,
        excluded_reasons=excluded_reasons,
    )


# ── Forecast helpers ───────────────────────────────────────────────────────────

def _backtest_metrics(actual: np.ndarray, predicted: np.ndarray) -> BacktestMetrics:
    """Compute MAPE, RMSE, MAE and Theil's U on test-set arrays."""
    mask = actual != 0
    mape = float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100) if mask.any() else 0.0
    rmse = float(np.sqrt(np.mean((actual - predicted) ** 2)))
    mae = float(np.mean(np.abs(actual - predicted)))

    # Theil's U: ratio of RMSE of model vs naive (last-value) forecast
    if len(actual) > 1:
        naive = actual[:-1]  # naive forecast = prior value
        naive_rmse = float(np.sqrt(np.mean((actual[1:] - naive) ** 2)))
        model_rmse = float(np.sqrt(np.mean((actual[1:] - predicted[1:]) ** 2)))
        theils_u = model_rmse / naive_rmse if naive_rmse > 0 else 0.0
    else:
        theils_u = 0.0

    return BacktestMetrics(mape=mape, rmse=rmse, mae=mae, theils_u=theils_u)


def _future_dates(last_date: str, horizon: int, interval: str = "1d") -> List[str]:
    """Generate future date strings based on data interval."""
    import pandas as pd
    try:
        last_dt = pd.to_datetime(last_date)
    except Exception:
        last_dt = pd.Timestamp.today()

    if interval == "5m":
        dates = pd.date_range(start=last_dt + pd.Timedelta(minutes=5), periods=horizon * 5, freq="5min")
        dates = dates[(dates.weekday < 5) & (dates.hour >= 8) & (dates.hour < 17)][:horizon]
    elif interval == "15m":
        dates = pd.date_range(start=last_dt + pd.Timedelta(minutes=15), periods=horizon * 5, freq="15min")
        dates = dates[(dates.weekday < 5) & (dates.hour >= 8) & (dates.hour < 17)][:horizon]
    elif interval == "1h":
        dates = pd.date_range(start=last_dt + pd.Timedelta(hours=1), periods=horizon * 5, freq="h")
        dates = dates[(dates.weekday < 5) & (dates.hour >= 8) & (dates.hour < 17)][:horizon]
    elif interval == "1wk":
        dates = pd.bdate_range(start=last_dt + pd.Timedelta(days=1), periods=horizon, freq="W-FRI")
    elif interval == "1mo":
        dates = pd.bdate_range(start=last_dt + pd.Timedelta(days=1), periods=horizon, freq="BM")
    else:  # "1d" default
        dates = pd.bdate_range(start=last_dt + pd.Timedelta(days=1), periods=horizon, freq="B")

    fmt = "%Y-%m-%dT%H:%M:%S" if interval in ("5m", "15m", "1h") else "%Y-%m-%d"
    return [d.strftime(fmt) for d in dates[:horizon]]


def _horizon_to_real_time(horizon: int, interval: str) -> str:
    """Convert horizon (number of bars) to human-readable real time duration."""
    if interval == "5m":
        total_min = horizon * 5
        hours, mins = divmod(total_min, 60)
        return f"{hours}h {mins}m" if mins else f"{hours}h"
    elif interval == "15m":
        total_min = horizon * 15
        hours, mins = divmod(total_min, 60)
        return f"{hours}h {mins}m" if mins else f"{hours}h"
    elif interval == "1h":
        if horizon < 24:
            return f"{horizon}h"
        days, hrs = divmod(horizon, 24)
        return f"{days}d {hrs}h" if hrs else f"{days}d"
    elif interval == "1d":
        return f"{horizon} days"
    elif interval == "1wk":
        return f"{horizon} weeks"
    elif interval == "1mo":
        return f"{horizon} months"
    return f"{horizon} periods"


def _run_arima(
    train: np.ndarray,
    test: np.ndarray,
    train_dates: List[str],
    test_dates: List[str],
    future_dates: List[str],
    horizon: int,
    confidence_level: float,
) -> ModelForecast:
    try:
        import pmdarima as pm
    except ImportError:
        return ModelForecast(
            model_name="arima",
            display_name="Auto-ARIMA (unavailable)",
            parameters={},
            forecast_values=[],
            backtest=BacktestResult(
                actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates, test)],
                predicted=[],
                metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
            ),
            error="pmdarima not installed",
        )

    alpha = 1.0 - confidence_level
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            auto_model = pm.auto_arima(
                train,
                seasonal=False,
                stepwise=True,
                suppress_warnings=True,
                error_action="ignore",
                max_p=3, max_q=3, max_d=2,
                max_order=6,
                n_fits=30,
                information_criterion="aic",
                with_intercept=True,
                method="lbfgs",
            )
        except Exception as exc:
            return ModelForecast(
                model_name="arima",
                display_name="Auto-ARIMA (failed)",
                parameters={},
                forecast_values=[],
                backtest=BacktestResult(
                    actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates, test)],
                    predicted=[],
                    metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                ),
                error=str(exc),
            )

    order = auto_model.order
    params = {"p": int(order[0]), "d": int(order[1]), "q": int(order[2])}
    display_name = f"Auto-ARIMA ({order[0]},{order[1]},{order[2]})"

    # Backtest: predict test period
    test_pred, test_ci = auto_model.predict(n_periods=len(test), return_conf_int=True, alpha=alpha)

    # Future forecast
    fcast, fcast_ci = auto_model.predict(n_periods=horizon, return_conf_int=True, alpha=alpha)

    backtest_result = BacktestResult(
        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates, test)],
        predicted=[
            ForecastPoint(
                date=d, value=float(p),
                ci_lower=float(test_ci[i, 0]), ci_upper=float(test_ci[i, 1]),
            )
            for i, (d, p) in enumerate(zip(test_dates, test_pred))
        ],
        metrics=_backtest_metrics(test, test_pred),
    )

    forecast_values = [
        ForecastPoint(
            date=d, value=float(fcast[i]),
            ci_lower=float(fcast_ci[i, 0]), ci_upper=float(fcast_ci[i, 1]),
        )
        for i, d in enumerate(future_dates)
    ]

    return ModelForecast(
        model_name="arima",
        display_name=display_name,
        parameters=params,
        forecast_values=forecast_values,
        backtest=backtest_result,
        aic=float(auto_model.aic()),
        bic=float(auto_model.bic()),
    )


def _run_ets(
    train: np.ndarray,
    test: np.ndarray,
    train_dates: List[str],
    test_dates: List[str],
    future_dates: List[str],
    horizon: int,
    confidence_level: float,
) -> ModelForecast:
    alpha = 1.0 - confidence_level
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            ets_fit = ExponentialSmoothing(
                train,
                trend="add",
                seasonal=None,
                initialization_method="estimated",
            ).fit(optimized=True)
        except Exception as exc:
            return ModelForecast(
                model_name="ets",
                display_name="ETS (failed)",
                parameters={},
                forecast_values=[],
                backtest=BacktestResult(
                    actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates, test)],
                    predicted=[],
                    metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                ),
                error=str(exc),
            )

    # Backtest predictions
    test_pred = ets_fit.forecast(len(test))

    # Residual std for CI approximation
    residuals_std = float(np.std(ets_fit.resid))
    z = float(scipy_stats.norm.ppf(1 - alpha / 2))

    # Future forecast
    fcast = ets_fit.forecast(horizon)

    # Propagate CI width grows with sqrt(steps) heuristic
    backtest_result = BacktestResult(
        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates, test)],
        predicted=[
            ForecastPoint(
                date=d, value=float(p),
                ci_lower=float(p) - z * residuals_std * np.sqrt(i + 1),
                ci_upper=float(p) + z * residuals_std * np.sqrt(i + 1),
            )
            for i, (d, p) in enumerate(zip(test_dates, test_pred))
        ],
        metrics=_backtest_metrics(test, np.array(test_pred)),
    )

    fcast_arr = np.asarray(fcast)
    forecast_values = [
        ForecastPoint(
            date=d, value=float(fcast_arr[i]),
            ci_lower=float(fcast_arr[i]) - z * residuals_std * np.sqrt(i + 1),
            ci_upper=float(fcast_arr[i]) + z * residuals_std * np.sqrt(i + 1),
        )
        for i, d in enumerate(future_dates)
    ]

    params = {
        "alpha": round(float(ets_fit.params.get("smoothing_level", 0)), 4),
        "beta": round(float(ets_fit.params.get("smoothing_trend", 0)), 4),
    }

    return ModelForecast(
        model_name="ets",
        display_name="ETS (Additive Trend)",
        parameters=params,
        forecast_values=forecast_values,
        backtest=backtest_result,
        aic=float(ets_fit.aic),
        bic=float(ets_fit.bic),
    )


def _run_linear(
    train: np.ndarray,
    test: np.ndarray,
    train_dates: List[str],
    test_dates: List[str],
    future_dates: List[str],
    horizon: int,
    confidence_level: float,
) -> ModelForecast:
    alpha = 1.0 - confidence_level
    n_train = len(train)
    x_train = np.arange(n_train, dtype=float)

    slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(x_train, train)

    # Backtest on test indices
    x_test = np.arange(n_train, n_train + len(test), dtype=float)
    test_pred = slope * x_test + intercept

    # Prediction intervals (t-based)
    t_crit = float(scipy_stats.t.ppf(1 - alpha / 2, df=n_train - 2))
    s_res = float(np.sqrt(np.sum((train - (slope * x_train + intercept)) ** 2) / (n_train - 2)))
    x_mean = float(np.mean(x_train))
    ssx = float(np.sum((x_train - x_mean) ** 2))

    def _pred_interval(xi: float) -> tuple:
        se = s_res * np.sqrt(1 + 1 / n_train + (xi - x_mean) ** 2 / ssx)
        y_hat = slope * xi + intercept
        return float(y_hat - t_crit * se), float(y_hat + t_crit * se)

    # Future indices
    x_future = np.arange(n_train, n_train + horizon, dtype=float)
    fcast = slope * x_future + intercept

    backtest_result = BacktestResult(
        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates, test)],
        predicted=[
            ForecastPoint(
                date=d, value=float(test_pred[i]),
                ci_lower=_pred_interval(x_test[i])[0],
                ci_upper=_pred_interval(x_test[i])[1],
            )
            for i, d in enumerate(test_dates)
        ],
        metrics=_backtest_metrics(test, test_pred),
    )

    forecast_values = [
        ForecastPoint(
            date=d, value=float(fcast[i]),
            ci_lower=_pred_interval(x_future[i])[0],
            ci_upper=_pred_interval(x_future[i])[1],
        )
        for i, d in enumerate(future_dates)
    ]

    return ModelForecast(
        model_name="linear",
        display_name="Linear Trend",
        parameters={
            "slope": round(float(slope), 6),
            "intercept": round(float(intercept), 4),
            "r_squared": round(float(r_value ** 2), 4),
            "p_value": round(float(p_value), 6),
        },
        forecast_values=forecast_values,
        backtest=backtest_result,
    )


def _run_hybrid_tft(
    values: np.ndarray,
    dates: list,
    horizon: int,
    confidence_level: float,
    train_test_split: float,
    test_vals: np.ndarray,
    test_dates_list: list,
) -> ModelForecast:
    """Run the Hybrid TFT + Wavelet + GARCH pipeline (synchronous, runs in executor)."""
    try:
        forecaster = HybridForecaster(wavelet="db4", wavelet_level=2, garch_p=1, garch_q=1)
        raw = forecaster.run_full_pipeline(
            values=values,
            dates=dates,
            horizon=horizon,
            confidence_level=confidence_level,
            train_test_split=train_test_split,
        )

        if raw.get("error"):
            raise RuntimeError(raw["error"])

        forecast_pts = [
            ForecastPoint(
                date=fp["date"],
                value=fp["value"],
                ci_lower=fp.get("ci_lower"),
                ci_upper=fp.get("ci_upper"),
                trend_component=fp.get("trend_component"),
                noise_std=fp.get("noise_std"),
            )
            for fp in raw.get("forecast_values", [])
        ]

        bt_raw = raw.get("backtest")
        if bt_raw:
            backtest = BacktestResult(
                actual=[
                    ForecastPoint(date=p["date"], value=p["value"])
                    for p in bt_raw["actual"]
                ],
                predicted=[
                    ForecastPoint(date=p["date"], value=p["value"])
                    for p in bt_raw["predicted"]
                ],
                metrics=BacktestMetrics(
                    mape=bt_raw["metrics"]["mape"],
                    rmse=bt_raw["metrics"]["rmse"],
                    mae=bt_raw["metrics"]["mae"],
                    theils_u=bt_raw["metrics"]["theils_u"],
                ),
            )
        else:
            backtest = BacktestResult(
                actual=[
                    ForecastPoint(date=d, value=float(v))
                    for d, v in zip(test_dates_list, test_vals)
                ],
                predicted=[],
                metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
            )

        params: dict = {str(k): str(v) for k, v in raw.get("parameters", {}).items()}
        if sh := raw.get("signal_health"):
            params["snr_db"] = str(sh.get("snr_db"))
            params["garch_regime"] = str(sh.get("volatility_regime"))
            params["ci_type"] = str(sh.get("ci_type"))
            params["tft_trained"] = str(sh.get("tft_trained"))
            params["noise_normality"] = str(sh.get("noise_normality"))

        return ModelForecast(
            model_name="hybrid_tft",
            display_name=raw.get("display_name", "Hybrid TFT + Wavelet + GARCH"),
            parameters=params,
            forecast_values=forecast_pts,
            backtest=backtest,
            aic=raw.get("aic"),
            bic=raw.get("bic"),
            historical_decomposition=raw.get("historical_decomposition"),
        )

    except Exception as exc:
        return ModelForecast(
            model_name="hybrid_tft",
            display_name="Hybrid TFT + Wavelet + GARCH (failed)",
            parameters={},
            forecast_values=[],
            backtest=BacktestResult(
                actual=[
                    ForecastPoint(date=d, value=float(v))
                    for d, v in zip(test_dates_list, test_vals)
                ],
                predicted=[],
                metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
            ),
            error=str(exc),
        )


# ── Forecast endpoint ──────────────────────────────────────────────────────────

@router.post("/forecast", response_model=ForecastResult)
def run_forecast(req: ForecastRequest) -> ForecastResult:
    if len(req.values) < 30:
        raise HTTPException(status_code=400, detail="Insufficient data for forecasting (minimum 30 data points required).")
    if len(req.values) != len(req.dates):
        raise HTTPException(status_code=400, detail="values and dates must have the same length.")

    # Clean data: remove NaN/Inf
    values_arr = np.array(req.values, dtype=float)
    dates_arr = np.array(req.dates)
    valid_mask = np.isfinite(values_arr)
    values_arr = values_arr[valid_mask]
    dates_arr = dates_arr[valid_mask]

    if len(values_arr) < 30:
        raise HTTPException(status_code=400, detail="Insufficient valid (non-NaN/Inf) data points after cleaning (minimum 30).")

    # Train/test split
    split_idx = max(int(len(values_arr) * req.train_test_split), 20)
    train_vals = values_arr[:split_idx]
    test_vals = values_arr[split_idx:]
    train_dates_list = dates_arr[:split_idx].tolist()
    test_dates_list = dates_arr[split_idx:].tolist()

    if len(test_vals) == 0:
        test_vals = train_vals[-5:]
        test_dates_list = train_dates_list[-5:]
        train_vals = train_vals[:-5]
        train_dates_list = train_dates_list[:-5]

    future_date_list = _future_dates(dates_arr[-1], req.horizon, req.interval)

    historical = [
        ForecastPoint(date=str(d), value=float(v))
        for d, v in zip(dates_arr.tolist(), values_arr.tolist())
    ]

    # ARIMA-specific: truncate training data to last MAX_ARIMA_POINTS to keep it fast.
    # Test set stays identical so all models are evaluated on the same holdout.
    arima_train = train_vals[-MAX_ARIMA_POINTS:] if len(train_vals) > MAX_ARIMA_POINTS else train_vals
    arima_train_dates = train_dates_list[-MAX_ARIMA_POINTS:] if len(train_dates_list) > MAX_ARIMA_POINTS else train_dates_list

    model_runners = {
        "ets": _run_ets,
        "linear": _run_linear,
    }

    results: List[ModelForecast] = []
    for model_name in req.models:
        mn = model_name.lower()

        if mn == "hybrid_tft":
            future = _tft_executor.submit(
                _run_hybrid_tft,
                values_arr, dates_arr.tolist(),
                req.horizon, req.confidence_level, req.train_test_split,
                test_vals, test_dates_list,
            )
            try:
                mf = future.result(timeout=TFT_TIMEOUT_SECONDS)
            except FuturesTimeoutError:
                future.cancel()
                mf = ModelForecast(
                    model_name="hybrid_tft",
                    display_name="Hybrid TFT + Wavelet + GARCH (timed out)",
                    parameters={},
                    forecast_values=[],
                    backtest=BacktestResult(
                        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates_list, test_vals)],
                        predicted=[],
                        metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                    ),
                    error=f"TFT timed out after {TFT_TIMEOUT_SECONDS}s. Training is CPU-intensive — try ARIMA/ETS for faster results.",
                )
            except Exception as exc:
                mf = ModelForecast(
                    model_name="hybrid_tft",
                    display_name="Hybrid TFT + Wavelet + GARCH (failed)",
                    parameters={},
                    forecast_values=[],
                    backtest=BacktestResult(
                        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates_list, test_vals)],
                        predicted=[],
                        metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                    ),
                    error=str(exc),
                )
        elif mn == "arima":
            # Run ARIMA in a thread with a hard timeout so slow fits never block ETS/Linear
            future = _arima_executor.submit(
                _run_arima,
                arima_train, test_vals,
                arima_train_dates, test_dates_list,
                future_date_list, req.horizon, req.confidence_level,
            )
            try:
                mf = future.result(timeout=ARIMA_TIMEOUT_SECONDS)
            except FuturesTimeoutError:
                future.cancel()
                mf = ModelForecast(
                    model_name="arima",
                    display_name="Auto-ARIMA (timed out)",
                    parameters={},
                    forecast_values=[],
                    backtest=BacktestResult(
                        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates_list, test_vals)],
                        predicted=[],
                        metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                    ),
                    error=f"ARIMA timed out after {ARIMA_TIMEOUT_SECONDS}s",
                )
            except Exception as exc:
                mf = ModelForecast(
                    model_name="arima",
                    display_name="Auto-ARIMA (failed)",
                    parameters={},
                    forecast_values=[],
                    backtest=BacktestResult(
                        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates_list, test_vals)],
                        predicted=[],
                        metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                    ),
                    error=str(exc),
                )
        else:
            runner = model_runners.get(mn)
            if runner is None:
                continue
            try:
                mf = runner(
                    train_vals, test_vals,
                    train_dates_list, test_dates_list,
                    future_date_list, req.horizon, req.confidence_level,
                )
            except Exception as exc:
                mf = ModelForecast(
                    model_name=model_name,
                    display_name=model_name.upper(),
                    parameters={},
                    forecast_values=[],
                    backtest=BacktestResult(
                        actual=[ForecastPoint(date=d, value=float(v)) for d, v in zip(test_dates_list, test_vals)],
                        predicted=[],
                        metrics=BacktestMetrics(mape=0, rmse=0, mae=0, theils_u=0),
                    ),
                    error=str(exc),
                )
        results.append(mf)

    if not results:
        raise HTTPException(status_code=400, detail="No valid models were specified.")

    # Best model = lowest MAPE among successful models
    successful = [m for m in results if not m.error and m.backtest.predicted]
    if successful:
        best = min(successful, key=lambda m: m.backtest.metrics.mape)
        best_model_name = best.model_name
    else:
        best_model_name = results[0].model_name

    return ForecastResult(
        dataset_name=req.name,
        models=results,
        historical=historical,
        best_model=best_model_name,
        train_size=len(train_vals),
        test_size=len(test_vals),
        forecast_horizon=req.horizon,
        interval=req.interval,
        horizon_real_time=_horizon_to_real_time(req.horizon, req.interval),
    )


# ── Helper: align two raw dicts by date ───────────────────────────────────────

def _align_two(dep: dict, ind: dict):
    """Inner-join two series dicts by date. Returns (dates_sorted, y_arr, x_arr)."""
    dep_map = dict(zip(dep["dates"], dep["values"]))
    ind_map = dict(zip(ind["dates"], ind["values"]))
    common = sorted(set(dep_map.keys()) & set(ind_map.keys()))
    if len(common) < 4:
        raise HTTPException(status_code=400, detail="Insufficient overlapping dates between series (need ≥ 4).")
    y = np.array([dep_map[d] for d in common])
    x = np.array([ind_map[d] for d in common])
    return common, y, x


# ── POST /regression/rolling ───────────────────────────────────────────────────

@router.post("/regression/rolling", response_model=RollingRegressionResult)
async def rolling_regression(req: RollingRegressionRequest):
    dates, y, x = _align_two(req.dependent, req.independent)
    n = len(dates)
    windows: list[RollingWindow] = []

    for win in req.window_sizes:
        if win >= n:
            continue
        pts: list[RollingWindowPoint] = []
        for i in range(win, n + 1):
            y_w = y[i - win: i]
            x_w = x[i - win: i]
            X_w = sm.add_constant(x_w, has_constant="add")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    res = sm.OLS(y_w, X_w).fit()
                intercept = float(res.params[0])
                beta = float(res.params[1])
                p_val = float(res.pvalues[1]) if len(res.pvalues) > 1 else 1.0
                r2 = float(res.rsquared)
            except Exception:
                continue
            pts.append(RollingWindowPoint(
                date=dates[i - 1],
                r_squared=round(r2, 6),
                beta=round(beta, 6),
                p_value=round(p_val, 6),
                intercept=round(intercept, 6),
            ))
        if pts:
            windows.append(RollingWindow(window_size=win, data=pts))

    if not windows:
        raise HTTPException(status_code=400, detail="No valid windows could be computed with the given data.")

    return RollingRegressionResult(
        windows=windows,
        dependent_name=req.dependent.get("name", "Y"),
        independent_name=req.independent.get("name", "X"),
    )


# ── POST /regression/structural-breaks ────────────────────────────────────────

@router.post("/regression/structural-breaks", response_model=StructuralBreakResult)
async def structural_breaks(req: StructuralBreakRequest):
    dates, y, x = _align_two(req.dependent, req.independent)
    n = len(dates)
    X_full = sm.add_constant(x, has_constant="add")

    cusum_result: Optional[dict] = None
    chow_result: Optional[dict] = None

    # ── CUSUM ──────────────────────────────────────────────────────────────────
    if req.method in ("cusum", "all"):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                ols_full = sm.OLS(y, X_full).fit()
                rresid, _rparams, _rvars, rresid_scaled = recursive_olsresiduals(ols_full)
            m = len(rresid_scaled)
            cusum_vals = np.cumsum(rresid_scaled) / np.sqrt(m)
            bound = 0.948  # 5% critical value
            start_idx = n - m  # recursive residuals start after initial k obs
            cusum_data = [
                {"date": dates[start_idx + i], "cusum": round(float(cusum_vals[i]), 6)}
                for i in range(m)
            ]
            breaks_detected = [
                {"date": d["date"], "cusum_value": d["cusum"]}
                for d in cusum_data
                if abs(d["cusum"]) > bound
            ]
            cusum_result = {
                "values": cusum_data,
                "upper_bound": bound,
                "lower_bound": -bound,
                "breaks_detected": breaks_detected,
            }
        except Exception as e:
            cusum_result = {"error": str(e)}

    # ── Chow ───────────────────────────────────────────────────────────────────
    if req.method in ("chow", "all"):
        k = X_full.shape[1]  # number of params (2: intercept + beta)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ols_full = sm.OLS(y, X_full).fit()
        rss_full = float(ols_full.ssr)

        # Candidate breakpoints
        if req.chow_test_date:
            candidates = [req.chow_test_date] if req.chow_test_date in dates else []
        else:
            # 10th to 90th percentile, every 10 pct
            candidates = [dates[int(n * p / 100)] for p in range(10, 100, 10)]

        chow_tests: list[dict] = []
        for bp_date in candidates:
            if bp_date not in dates:
                continue
            idx = dates.index(bp_date)
            if idx < k + 1 or idx > n - k - 1:
                continue
            y1, X1 = y[:idx], X_full[:idx]
            y2, X2 = y[idx:], X_full[idx:]
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    r1 = sm.OLS(y1, X1).fit()
                    r2 = sm.OLS(y2, X2).fit()
                rss1, rss2 = float(r1.ssr), float(r2.ssr)
                n1, n2 = len(y1), len(y2)
                numerator = (rss_full - rss1 - rss2) / k
                denominator = (rss1 + rss2) / (n1 + n2 - 2 * k)
                if denominator <= 0:
                    continue
                f_stat = numerator / denominator
                p_val = float(1 - f_dist.cdf(f_stat, k, n1 + n2 - 2 * k))
                chow_tests.append({
                    "date": bp_date,
                    "f_statistic": round(f_stat, 4),
                    "p_value": round(p_val, 6),
                })
            except Exception:
                continue

        if chow_tests:
            significant = [t for t in chow_tests if t["p_value"] < 0.05]
            most_sig = min(chow_tests, key=lambda t: t["p_value"]) if chow_tests else None
            if most_sig and most_sig["p_value"] >= 0.05:
                most_sig = None
            chow_result = {
                "tests": chow_tests,
                "most_significant": most_sig,
                "breaks_detected": significant,
            }
        else:
            chow_result = {"tests": [], "most_significant": None, "breaks_detected": []}

    return StructuralBreakResult(
        cusum=cusum_result,
        chow=chow_result,
        dependent_name=req.dependent.get("name", "Y"),
        independent_name=req.independent.get("name", "X"),
    )


# ── POST /smc ──────────────────────────────────────────────────────────────────

@router.post("/smc")
def run_smc(req: SMCRequest) -> dict:
    if len(req.dates) < 50:
        raise HTTPException(status_code=400, detail="SMC analysis requires at least 50 bars of OHLCV data.")
    lengths = {len(req.dates), len(req.opens), len(req.highs), len(req.lows), len(req.closes), len(req.volumes)}
    if len(lengths) != 1:
        raise HTTPException(status_code=400, detail="All OHLCV arrays must have the same length.")

    df = pd.DataFrame({
        "date":   req.dates,
        "open":   req.opens,
        "high":   req.highs,
        "low":    req.lows,
        "close":  req.closes,
        "volume": req.volumes,
    })

    if req.visible_bars > 0 and len(df) > req.visible_bars:
        df = df.tail(req.visible_bars).reset_index(drop=True)

    engine = SMCEngine(swing_lookback=req.swing_lookback)
    result = engine.analyze(df)
    result["candles"] = df.to_dict(orient="records")
    result["interval"] = req.interval
    return result
