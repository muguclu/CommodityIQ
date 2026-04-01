import calendar
from typing import List

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from statsmodels.tsa.seasonal import STL

from app.models.schemas import (
    SeasonalityRequest, SeasonalityResult,
    YoYRequest, YoYResult,
    SeasonalSignalRequest, SeasonalSignalResult,
)

def _freq(alias: str) -> str:
    """Return the correct pandas frequency alias for the installed version."""
    _major, _minor = int(pd.__version__.split(".")[0]), int(pd.__version__.split(".")[1])
    new_pandas = (_major > 2) or (_major == 2 and _minor >= 2)
    mapping_old_to_new = {"M": "ME", "Q": "QE", "Y": "YE", "BM": "BME"}
    mapping_new_to_old = {v: k for k, v in mapping_old_to_new.items()}
    if new_pandas:
        return mapping_old_to_new.get(alias, alias)
    else:
        return mapping_new_to_old.get(alias, alias)


router = APIRouter(tags=["seasonality"])


@router.post("/seasonality", response_model=SeasonalityResult)
def run_seasonality(req: SeasonalityRequest) -> SeasonalityResult:
    if len(req.dates) < 4:
        raise HTTPException(status_code=400, detail="At least 4 data points required.")
    if len(req.dates) != len(req.values):
        raise HTTPException(status_code=400, detail="dates and values must have the same length.")

    try:
        series = pd.Series(req.values, index=pd.to_datetime(req.dates))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid dates: {exc}")

    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]
    series = series.asfreq("B")
    series = series.ffill().bfill()

    period = req.period
    if period <= 0:
        period = 252

    while len(series) < period * 2 and period > 20:
        period = period // 2

    if len(series) < period * 2:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {period * 2} data points. Got {len(series)}.",
        )

    # ── STL Decomposition ──────────────────────────────────────────────────────
    stl = STL(series, period=period, robust=True)
    stl_res = stl.fit()

    trend    = stl_res.trend
    seasonal = stl_res.seasonal
    residual = stl_res.resid

    var_resid         = float(np.var(residual.dropna()))
    var_seas_residual = float(np.var((seasonal + residual).dropna()))
    if var_seas_residual > 0:
        seasonal_strength = float(max(0.0, min(1.0, 1.0 - var_resid / var_seas_residual)))
    else:
        seasonal_strength = 0.0

    if seasonal_strength >= 0.6:
        strength_label = "Strong"
    elif seasonal_strength >= 0.3:
        strength_label = "Moderate"
    else:
        strength_label = "Weak"

    def _safe(v: float) -> float:
        return round(float(v), 6) if not (np.isnan(v) or np.isinf(v)) else None  # type: ignore[return-value]

    decomposition = {
        "dates":    [d.strftime("%Y-%m-%d") for d in series.index],
        "observed": [_safe(v) for v in series.values],
        "trend":    [_safe(v) for v in trend.values],
        "seasonal": [_safe(v) for v in seasonal.values],
        "residual": [_safe(v) for v in residual.values],
    }

    # ── Monthly Return Statistics ──────────────────────────────────────────────
    monthly_prices  = series.resample(_freq("M")).last()
    monthly_returns = monthly_prices.pct_change().dropna()

    monthly_stats: List[dict] = []
    for month in range(1, 13):
        md = monthly_returns[monthly_returns.index.month == month]
        if len(md) == 0:
            monthly_stats.append({
                "month": month,
                "month_name": calendar.month_abbr[month],
                "mean_return": 0.0,
                "median_return": 0.0,
                "std_return": 0.0,
                "positive_pct": 0.0,
                "count": 0,
                "best_year": None,
                "worst_year": None,
            })
            continue

        best_idx  = md.idxmax()
        worst_idx = md.idxmin()
        monthly_stats.append({
            "month":         month,
            "month_name":    calendar.month_abbr[month],
            "mean_return":   round(float(md.mean()),   6),
            "median_return": round(float(md.median()), 6),
            "std_return":    round(float(md.std(skipna=True)), 6) if len(md) > 1 else 0.0,
            "positive_pct":  round(float((md > 0).mean()), 4),
            "count":         int(len(md)),
            "best_year":     {"year": int(best_idx.year),  "return": round(float(md[best_idx]),  6)},
            "worst_year":    {"year": int(worst_idx.year), "return": round(float(md[worst_idx]), 6)},
        })

    # ── Monthly Matrix (year × month heatmap) ─────────────────────────────────
    years       = sorted(int(y) for y in monthly_returns.index.year.unique())
    months_abbr = [calendar.month_abbr[m] for m in range(1, 13)]
    matrix_values = []
    for year in years:
        row = []
        for month in range(1, 13):
            mask = (monthly_returns.index.year == year) & (monthly_returns.index.month == month)
            vals = monthly_returns[mask]
            row.append(round(float(vals.iloc[0]), 6) if len(vals) > 0 else None)
        matrix_values.append(row)

    monthly_matrix = {
        "years":  years,
        "months": months_abbr,
        "values": matrix_values,
    }

    # ── Day-of-Week Effect ─────────────────────────────────────────────────────
    daily_returns = series.pct_change().dropna()
    day_of_week: List[dict] = []
    for day in range(5):
        dd = daily_returns[daily_returns.index.dayofweek == day]
        day_of_week.append({
            "day":          day,
            "day_name":     calendar.day_abbr[day],
            "mean_return":  round(float(dd.mean()),              6) if len(dd) > 0 else 0.0,
            "std_return":   round(float(dd.std()),               6) if len(dd) > 1 else 0.0,
            "positive_pct": round(float((dd > 0).mean()),        4) if len(dd) > 0 else 0.0,
            "count":        int(len(dd)),
        })

    # ── Week-of-Year Pattern ───────────────────────────────────────────────────
    weekly_prices  = series.resample("W").last()
    weekly_returns = weekly_prices.pct_change().dropna()

    iso_weeks = weekly_returns.index.isocalendar().week.astype(int).values
    weekly_df = pd.DataFrame({"ret": weekly_returns.values, "week": iso_weeks})
    week_agg  = (
        weekly_df.groupby("week")["ret"]
        .agg(["mean", "std", "count"])
        .reset_index()
    )

    weekly_pattern: List[dict] = []
    for _, row in week_agg.iterrows():
        std_val = float(row["std"]) if not np.isnan(row["std"]) else 0.0
        weekly_pattern.append({
            "week":        int(row["week"]),
            "mean_return": round(float(row["mean"]), 6),
            "std":         round(std_val, 6),
            "count":       int(row["count"]),
        })

    # ── Period label ───────────────────────────────────────────────────────────
    first_date  = series.index[0]
    last_date   = series.index[-1]
    total_years = round((last_date - first_date).days / 365.25, 1)
    period_str  = f"{first_date.strftime('%b %Y')} — {last_date.strftime('%b %Y')}"

    return SeasonalityResult(
        decomposition=decomposition,
        seasonal_strength=round(seasonal_strength, 4),
        seasonal_strength_label=strength_label,
        monthly_stats=monthly_stats,
        monthly_matrix=monthly_matrix,
        day_of_week=day_of_week,
        weekly_pattern=weekly_pattern,
        dataset_name=req.name,
        period_analyzed=period_str,
        total_years=total_years,
    )


@router.post("/seasonality/yoy", response_model=YoYResult)
def run_yoy(req: YoYRequest) -> YoYResult:
    if len(req.dates) != len(req.values):
        raise HTTPException(status_code=400, detail="dates and values must have the same length.")
    if len(req.dates) < 10:
        raise HTTPException(status_code=400, detail="At least 10 data points required.")

    try:
        series = pd.Series(req.values, index=pd.to_datetime(req.dates))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid dates: {exc}")

    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]

    current_year = int(series.index.year.max())
    available_years = sorted(int(y) for y in series.index.year.unique())
    selected_years = available_years[-req.years_to_show:] if req.years_to_show < len(available_years) else available_years

    years_data: dict = {}
    year_summaries: List[dict] = []

    for year in selected_years:
        yr_series = series[series.index.year == year]
        if len(yr_series) < 10:
            continue

        yr_series = yr_series.reset_index()
        yr_series.columns = ["date", "close"]
        yr_series["trading_day"] = range(1, len(yr_series) + 1)

        if req.normalize:
            base = float(yr_series.iloc[0]["close"])
            if base == 0:
                continue
            yr_series["value"] = (yr_series["close"] / base) * 100.0
        else:
            yr_series["value"] = yr_series["close"].astype(float)

        records = [
            {"trading_day": int(row["trading_day"]), "value": round(float(row["value"]), 4)}
            for _, row in yr_series.iterrows()
        ]
        years_data[str(year)] = records

        values_arr = yr_series["value"].values
        first_val  = float(values_arr[0])
        last_val   = float(values_arr[-1])
        ytd_return = (last_val / first_val - 1.0) if not req.normalize else (last_val - 100.0) / 100.0

        year_summaries.append({
            "year":         year,
            "ytd_return":   round(ytd_return, 6),
            "max_value":    round(float(values_arr.max()), 4),
            "min_value":    round(float(values_arr.min()), 4),
            "final_value":  round(last_val, 4),
            "trading_days": int(len(yr_series)),
        })

    # ── Mean / band across years ───────────────────────────────────────────────
    all_values_by_day: dict = {}
    for yr_records in years_data.values():
        for row in yr_records:
            day = row["trading_day"]
            all_values_by_day.setdefault(day, []).append(row["value"])

    mean_band = []
    for day, vals in sorted(all_values_by_day.items()):
        if len(vals) < 2:
            continue
        arr  = np.array(vals, dtype=float)
        mean = float(np.mean(arr))
        std  = float(np.std(arr))
        mean_band.append({
            "trading_day": day,
            "mean":  round(mean, 4),
            "std":   round(std,  4),
            "upper": round(mean + std, 4),
            "lower": round(mean - std, 4),
        })

    return YoYResult(
        years_data=years_data,
        mean_band=mean_band,
        current_year=current_year,
        normalized=req.normalize,
        dataset_name=req.name,
        year_summaries=year_summaries,
    )


@router.post("/seasonality/signals", response_model=SeasonalSignalResult)
def run_seasonal_signals(req: SeasonalSignalRequest) -> SeasonalSignalResult:
    if len(req.dates) != len(req.values):
        raise HTTPException(status_code=400, detail="dates and values must have the same length.")
    if len(req.dates) < 30:
        raise HTTPException(status_code=400, detail="At least 30 data points required.")

    try:
        series = pd.Series(req.values, index=pd.to_datetime(req.dates))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid dates: {exc}")

    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]

    # ── Monthly statistics ─────────────────────────────────────────────────────
    monthly_prices  = series.resample(_freq("M")).last()
    monthly_returns = monthly_prices.pct_change().dropna()

    monthly_stats: dict = {}
    for month in range(1, 13):
        md = monthly_returns[monthly_returns.index.month == month]
        if len(md) == 0:
            continue
        monthly_stats[month] = {
            "mean_return": float(md.mean()),
            "positive_pct": float((md > 0).mean()),
            "count": int(len(md)),
        }

    # ── Classify months ────────────────────────────────────────────────────────
    strong_months:  List[int] = []
    weak_months:    List[int] = []
    neutral_months: List[int] = []

    for month, stats in monthly_stats.items():
        if stats["count"] < req.min_years:
            neutral_months.append(month)
            continue
        if stats["positive_pct"] > req.positive_threshold:
            strong_months.append(month)
        elif stats["positive_pct"] < req.negative_threshold:
            weak_months.append(month)
        else:
            neutral_months.append(month)

    strong_months.sort()
    weak_months.sort()
    neutral_months.sort()

    # ── Calendar signals ───────────────────────────────────────────────────────
    calendar_signals = []
    for month in range(1, 13):
        stats = monthly_stats.get(month, {})
        if month in strong_months:
            signal = "strong"
        elif month in weak_months:
            signal = "weak"
        else:
            signal = "neutral"
        calendar_signals.append({
            "month":        month,
            "month_name":   calendar.month_abbr[month],
            "signal":       signal,
            "avg_return":   round(stats.get("mean_return", 0.0), 6),
            "positive_pct": round(stats.get("positive_pct", 0.0), 4),
            "confidence":   "high" if stats.get("count", 0) >= 5 else "low",
        })

    # ── Backtest ───────────────────────────────────────────────────────────────
    daily_returns = series.pct_change().dropna()

    strategy_returns = daily_returns.copy()
    for i in range(len(strategy_returns)):
        if strategy_returns.index[i].month not in strong_months:
            strategy_returns.iloc[i] = 0.0

    def _calc_metrics(rets: pd.Series) -> dict:
        annual_return = float((1 + rets.mean()) ** 252 - 1)
        annual_vol    = float(rets.std() * np.sqrt(252))
        sharpe        = annual_return / annual_vol if annual_vol > 0 else 0.0

        equity    = (1 + rets).cumprod()
        peak      = equity.expanding().max()
        drawdown  = (equity - peak) / peak
        max_dd    = float(drawdown.min())

        downside  = float(rets[rets < 0].std() * np.sqrt(252)) if len(rets[rets < 0]) > 1 else 0.0
        sortino   = annual_return / downside if downside > 0 else 0.0

        monthly_r = rets.resample(_freq("M")).sum()
        win_rate  = float((monthly_r > 0).mean())

        return {
            "annual_return":     round(annual_return, 6),
            "annual_volatility": round(annual_vol, 6),
            "sharpe_ratio":      round(sharpe, 4),
            "sortino_ratio":     round(sortino, 4),
            "max_drawdown":      round(max_dd, 6),
            "win_rate":          round(win_rate, 4),
            "total_return":      round(float((1 + rets).prod() - 1), 6),
            "num_trades":        int(len(strong_months)),
        }

    seasonal_metrics = _calc_metrics(strategy_returns)
    buyhold_metrics  = _calc_metrics(daily_returns)

    # Equity curves — subsample for payload size
    bh_equity  = (1 + daily_returns).cumprod() * 100
    sea_equity = (1 + strategy_returns).cumprod() * 100
    step = max(1, len(bh_equity) // 500)
    bh_sub  = bh_equity.iloc[::step]
    sea_sub = sea_equity.iloc[::step]

    equity_curves = {
        "dates":              [d.strftime("%Y-%m-%d") for d in bh_sub.index],
        "buy_and_hold":       [round(float(v), 4) for v in bh_sub.values],
        "seasonal_strategy":  [round(float(v), 4) for v in sea_sub.values],
    }

    # ── Strategy description ───────────────────────────────────────────────────
    month_names = [calendar.month_abbr[m] for m in strong_months]
    if month_names:
        desc = f"Long in {', '.join(month_names)}. Flat all other months."
    else:
        desc = "No strong months identified — strategy stays flat year-round."

    outperformance = seasonal_metrics["total_return"] - buyhold_metrics["total_return"]

    return SeasonalSignalResult(
        strong_months=strong_months,
        weak_months=weak_months,
        neutral_months=neutral_months,
        calendar_signals=calendar_signals,
        equity_curves=equity_curves,
        seasonal_metrics=seasonal_metrics,
        buyhold_metrics=buyhold_metrics,
        strategy_description=desc,
        outperformance=round(outperformance, 6),
        dataset_name=req.name,
    )
