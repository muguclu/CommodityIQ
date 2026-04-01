from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
import pandas as pd
import numpy as np
from scipy import stats

from app.models.schemas import (
    CorrelationRequest,
    CorrelationResult,
    RollingCorrelationRequest,
    RollingCorrelationResult,
    GrangerRequest,
    GrangerResult,
    RegimeScatterRequest,
    RegimeScatterResult,
    CrossLagRequest,
    CrossLagResult,
    CorrelationAlertRequest,
    CorrelationAlertResult,
)

router = APIRouter(tags=["correlation"])


# ── Helpers ─────────────────────────────────────────────────────────────────────


def _build_df(datasets: List[dict], period: str, use_returns: bool) -> pd.DataFrame:
    series_list = []
    for ds in datasets:
        s = pd.Series(
            [float(v) for v in ds["values"]],
            index=pd.to_datetime(ds["dates"]),
            name=ds["name"],
        )
        series_list.append(s)

    df = pd.concat(series_list, axis=1).sort_index().dropna()

    if period == "1y":
        cutoff = df.index[-1] - pd.DateOffset(years=1)
        df = df[df.index >= cutoff]
    elif period == "2y":
        cutoff = df.index[-1] - pd.DateOffset(years=2)
        df = df[df.index >= cutoff]
    elif period == "3y":
        cutoff = df.index[-1] - pd.DateOffset(years=3)
        df = df[df.index >= cutoff]
    elif period == "ytd":
        df = df[df.index.year == df.index[-1].year]

    if use_returns:
        df = df.pct_change().dropna()

    return df


def _extract_pairs(corr_df: pd.DataFrame, p_df: pd.DataFrame, top: bool, n: int = 5) -> List[dict]:
    names = list(corr_df.columns)
    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            pairs.append({
                "pair": f"{names[i]} — {names[j]}",
                "asset_a": names[i],
                "asset_b": names[j],
                "correlation": round(float(corr_df.iloc[i, j]), 4),
                "p_value": round(float(p_df.iloc[i, j]), 8),
                "significant": bool(p_df.iloc[i, j] < 0.05),
            })

    pairs.sort(key=lambda x: abs(x["correlation"]), reverse=top)
    return pairs[:n]


def _p_matrix(df: pd.DataFrame, method: str) -> pd.DataFrame:
    cols = df.columns
    n_cols = len(cols)
    pvals = np.zeros((n_cols, n_cols))
    for i in range(n_cols):
        for j in range(n_cols):
            if i == j:
                pvals[i, j] = 0.0
            else:
                x, y = df.iloc[:, i].values, df.iloc[:, j].values
                if method == "spearman":
                    _, p = stats.spearmanr(x, y)
                else:
                    _, p = stats.pearsonr(x, y)
                pvals[i, j] = float(p)
    return pd.DataFrame(pvals, index=cols, columns=cols)


def _pca_summary(corr_matrix: pd.DataFrame) -> dict:
    eigenvalues = np.linalg.eigvals(corr_matrix.values).real
    eigenvalues = np.sort(eigenvalues)[::-1]
    eigenvalues = np.maximum(eigenvalues, 0.0)
    total = eigenvalues.sum()
    explained = (eigenvalues / total * 100).tolist() if total > 0 else [0.0] * len(eigenvalues)
    first_pct = float(explained[0]) if explained else 0.0

    if first_pct > 60:
        interpretation = f"The first component explains {first_pct:.1f}% of variance — commodities are highly co-moving (systemic risk)."
    elif first_pct > 40:
        interpretation = f"The first component explains {first_pct:.1f}% of variance — moderate co-movement with some diversification."
    else:
        interpretation = f"The first component explains {first_pct:.1f}% of variance — low co-movement, good diversification potential."

    return {
        "eigenvalues": [round(float(e), 4) for e in eigenvalues.tolist()],
        "explained_variance_pct": [round(float(e), 2) for e in explained],
        "first_component_explains": round(first_pct, 2),
        "interpretation": interpretation,
    }


# ── POST /correlation ────────────────────────────────────────────────────────────


@router.post("/correlation", response_model=CorrelationResult)
def run_correlation(req: CorrelationRequest) -> CorrelationResult:
    if len(req.datasets) < 2:
        raise HTTPException(status_code=400, detail="At least 2 datasets are required for correlation analysis.")
    for ds in req.datasets:
        if len(ds.get("values", [])) != len(ds.get("dates", [])):
            raise HTTPException(status_code=400, detail=f"Dataset '{ds.get('name')}': values and dates length mismatch.")

    try:
        df = _build_df(req.datasets, req.period, req.use_returns)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to build aligned dataframe: {exc}")

    if len(df) < 5:
        raise HTTPException(status_code=400, detail="Not enough overlapping observations after alignment and period filter.")

    method = req.method if req.method in ("pearson", "spearman") else "pearson"
    corr_df = df.corr(method=method)
    p_df = _p_matrix(df, method)

    columns = list(corr_df.columns)
    corr_matrix = {
        "columns": columns,
        "values": [[round(float(corr_df.loc[r, c]), 4) for c in columns] for r in columns],
    }
    p_value_matrix = {
        "columns": columns,
        "values": [[round(float(p_df.loc[r, c]), 8) for c in columns] for r in columns],
    }

    return CorrelationResult(
        correlation_matrix=corr_matrix,
        p_value_matrix=p_value_matrix,
        method=method,
        used_returns=req.use_returns,
        num_observations=int(len(df)),
        period_start=str(df.index[0].date()),
        period_end=str(df.index[-1].date()),
        top_correlations=_extract_pairs(corr_df, p_df, top=True),
        bottom_correlations=_extract_pairs(corr_df, p_df, top=False),
        pca_summary=_pca_summary(corr_df),
    )


# ── POST /correlation/rolling ────────────────────────────────────────────────────


@router.post("/correlation/rolling", response_model=RollingCorrelationResult)
def run_rolling_correlation(req: RollingCorrelationRequest) -> RollingCorrelationResult:
    a = req.asset_a
    b = req.asset_b
    a_name, b_name = a["name"], b["name"]

    try:
        s_a = pd.Series([float(v) for v in a["values"]], index=pd.to_datetime(a["dates"]), name=a_name)
        s_b = pd.Series([float(v) for v in b["values"]], index=pd.to_datetime(b["dates"]), name=b_name)
        df = pd.concat([s_a, s_b], axis=1).sort_index().dropna()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to align series: {exc}")

    if req.use_returns:
        df = df.pct_change().dropna()

    if len(df) < max(req.window_sizes):
        raise HTTPException(
            status_code=400,
            detail=f"Not enough observations ({len(df)}) for requested window sizes ({req.window_sizes}).",
        )

    rolling_data: Dict[str, Any] = {}
    for w in req.window_sizes:
        rc = df[a_name].rolling(window=w).corr(df[b_name]).dropna()
        rolling_data[str(w)] = [
            {"date": str(dt.date()), "correlation": round(float(v), 4)}
            for dt, v in rc.items()
        ]

    ref_window = min(60, max(req.window_sizes))
    all_corrs = df[a_name].rolling(window=ref_window).corr(df[b_name]).dropna()
    corr_mean = float(all_corrs.mean())
    corr_std  = float(all_corrs.std())
    corr_min  = float(all_corrs.min())
    corr_max  = float(all_corrs.max())
    current   = float(all_corrs.iloc[-1])
    below_count = int((all_corrs <= current).sum())
    pctile = round(below_count / len(all_corrs) * 100, 1)

    historical_stats = {
        "mean": round(corr_mean, 4),
        "std": round(corr_std, 4),
        "min": round(corr_min, 4),
        "max": round(corr_max, 4),
        "current": round(current, 4),
        "percentile_current": pctile,
    }

    high_thresh   = corr_mean + corr_std
    low_thresh    = corr_mean - corr_std
    regimes: List[dict] = []
    regime_start: str | None = None
    prev_regime:  str | None = None

    for dt, val in all_corrs.items():
        if val > high_thresh:
            r = "high"
        elif val < low_thresh:
            r = "low"
        else:
            r = "medium"

        if r != prev_regime:
            if prev_regime is not None and regime_start is not None:
                window_slice = all_corrs[regime_start:str(dt.date())]
                regimes.append({
                    "start": regime_start,
                    "end": str(dt.date()),
                    "avg_correlation": round(float(window_slice.mean()), 4),
                    "regime": prev_regime,
                })
            regime_start = str(dt.date())
            prev_regime  = r

    if prev_regime is not None and regime_start is not None:
        window_slice = all_corrs[regime_start:]
        regimes.append({
            "start": regime_start,
            "end": str(all_corrs.index[-1].date()),
            "avg_correlation": round(float(window_slice.mean()), 4),
            "regime": prev_regime,
        })

    return RollingCorrelationResult(
        asset_a_name=a_name,
        asset_b_name=b_name,
        rolling_data=rolling_data,
        historical_stats=historical_stats,
        regimes=regimes[-20:],
    )


# ── POST /correlation/granger ────────────────────────────────────────────────────


@router.post("/correlation/granger", response_model=GrangerResult)
def run_granger(req: GrangerRequest) -> GrangerResult:
    if len(req.datasets) < 2:
        raise HTTPException(status_code=400, detail="At least 2 datasets are required for Granger causality.")

    try:
        from statsmodels.tsa.stattools import grangercausalitytests
    except ImportError:
        raise HTTPException(status_code=503, detail="statsmodels is required for Granger causality tests.")

    try:
        df = _build_df(req.datasets, period="full", use_returns=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to build aligned dataframe: {exc}")

    if len(df) < req.max_lag * 3:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient observations ({len(df)}) for max_lag={req.max_lag}. Need at least {req.max_lag * 3}.",
        )

    results: List[dict] = []
    names = list(df.columns)

    for i, cause_name in enumerate(names):
        for j, effect_name in enumerate(names):
            if i == j:
                continue
            try:
                test_data = df[[effect_name, cause_name]].dropna()
                gc_res = grangercausalitytests(test_data, maxlag=req.max_lag, verbose=False)
                best_lag = min(gc_res.keys(), key=lambda k: gc_res[k][0]["ssr_ftest"][1])
                f_stat   = float(gc_res[best_lag][0]["ssr_ftest"][0])
                p_val    = float(gc_res[best_lag][0]["ssr_ftest"][1])
                results.append({
                    "cause":      cause_name,
                    "effect":     effect_name,
                    "best_lag":   int(best_lag),
                    "f_statistic": round(f_stat, 4),
                    "p_value":    round(p_val, 8),
                    "significant": bool(p_val < req.significance),
                    "direction":  f"{cause_name} \u2192 {effect_name}",
                })
            except Exception as exc:
                results.append({
                    "cause":      cause_name,
                    "effect":     effect_name,
                    "best_lag":   0,
                    "f_statistic": 0.0,
                    "p_value":    1.0,
                    "significant": False,
                    "direction":  f"{cause_name} \u2192 {effect_name}",
                    "error":      str(exc),
                })

    significant = [r for r in results if r.get("significant")]
    results.sort(key=lambda x: x["p_value"])

    edges = [
        {
            "from":     r["cause"],
            "to":       r["effect"],
            "lag":      r["best_lag"],
            "strength": r["p_value"],
        }
        for r in significant
    ]
    network = {
        "nodes": names,
        "edges": edges,
    }

    return GrangerResult(
        results=results,
        significant_pairs=significant,
        network=network,
        max_lag_tested=req.max_lag,
        significance_level=req.significance,
    )


# ── POST /correlation/regime-scatter ──────────────────────────────────────


@router.post("/correlation/regime-scatter", response_model=RegimeScatterResult)
def run_regime_scatter(req: RegimeScatterRequest) -> RegimeScatterResult:
    a, b = req.asset_a, req.asset_b
    a_name, b_name = a["name"], b["name"]

    try:
        s_a = pd.Series([float(v) for v in a["values"]], index=pd.to_datetime(a["dates"]), name=a_name)
        s_b = pd.Series([float(v) for v in b["values"]], index=pd.to_datetime(b["dates"]), name=b_name)
        df = pd.concat([s_a, s_b], axis=1).sort_index().dropna()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to align series: {exc}")

    if len(df) < req.regime_window * 2:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough observations ({len(df)}) for regime_window={req.regime_window}.",
        )

    returns_a = df[a_name].pct_change().dropna()
    returns_b = df[b_name].pct_change().dropna()

    combined_vol = (
        returns_a.rolling(req.regime_window).std() +
        returns_b.rolling(req.regime_window).std()
    ) / 2
    combined_vol = combined_vol.dropna()

    low_threshold  = float(combined_vol.quantile(0.33))
    high_threshold = float(combined_vol.quantile(0.67))

    regimes = pd.Series("Medium", index=combined_vol.index)
    regimes[combined_vol <= low_threshold]  = "Low"
    regimes[combined_vol >= high_threshold] = "High"

    aligned = pd.concat([returns_a, returns_b, regimes], axis=1).dropna()
    aligned.columns = [a_name, b_name, "regime"]

    scatter_data: List[dict] = [
        {
            "x": round(float(row[a_name]), 6),
            "y": round(float(row[b_name]), 6),
            "date": str(idx.date()),
            "regime": row["regime"],
        }
        for idx, row in aligned.iterrows()
    ]

    regime_correlations: Dict[str, Any] = {}
    regime_regressions:  Dict[str, Any] = {}

    for regime in ["Low", "Medium", "High"]:
        sub = aligned[aligned["regime"] == regime]
        if len(sub) < 10:
            continue
        x_vals = sub[a_name].values.astype(float)
        y_vals = sub[b_name].values.astype(float)

        corr_val, p_val = stats.pearsonr(x_vals, y_vals)
        regime_correlations[regime] = {
            "correlation":      round(float(corr_val), 4),
            "p_value":          round(float(p_val), 8),
            "num_observations": int(len(sub)),
            "pct_of_total":     round(len(sub) / len(aligned), 4),
        }

        slope, intercept, r_value, _, _ = stats.linregress(x_vals, y_vals)
        regime_regressions[regime] = {
            "slope":     round(float(slope), 6),
            "intercept": round(float(intercept), 6),
            "r_squared": round(float(r_value ** 2), 4),
        }

    return RegimeScatterResult(
        scatter_data=scatter_data,
        regime_correlations=regime_correlations,
        regime_regressions=regime_regressions,
        regime_thresholds={"low_vol": round(low_threshold, 6), "high_vol": round(high_threshold, 6)},
        asset_a_name=a_name,
        asset_b_name=b_name,
    )


# ── POST /correlation/cross-lag ───────────────────────────────────────────


@router.post("/correlation/cross-lag", response_model=CrossLagResult)
def run_cross_lag(req: CrossLagRequest) -> CrossLagResult:
    a, b = req.asset_a, req.asset_b
    a_name, b_name = a["name"], b["name"]

    try:
        s_a = pd.Series([float(v) for v in a["values"]], index=pd.to_datetime(a["dates"]), name=a_name)
        s_b = pd.Series([float(v) for v in b["values"]], index=pd.to_datetime(b["dates"]), name=b_name)
        df = pd.concat([s_a, s_b], axis=1).sort_index().dropna()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to align series: {exc}")

    if len(df) < req.max_lag * 3:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough observations ({len(df)}) for max_lag={req.max_lag}.",
        )

    returns_a = df[a_name].pct_change().dropna()
    returns_b = df[b_name].pct_change().dropna()

    cross_corr: List[dict] = []
    for lag in range(-req.max_lag, req.max_lag + 1):
        try:
            if lag > 0:
                corr = float(returns_a.iloc[:-lag].corr(returns_b.iloc[lag:]))
            elif lag < 0:
                corr = float(returns_a.iloc[-lag:].corr(returns_b.iloc[:lag]))
            else:
                corr = float(returns_a.corr(returns_b))
        except Exception:
            corr = 0.0
        cross_corr.append({"lag": lag, "correlation": round(corr, 4)})

    best = max(cross_corr, key=lambda x: abs(x["correlation"]))
    opt_lag  = int(best["lag"])
    opt_corr = float(best["correlation"])

    if opt_lag > 0:
        interp = f"{a_name} tends to lead {b_name} by {opt_lag} trading day{'s' if opt_lag != 1 else ''}. Price moves in {a_name} may predict future moves in {b_name}."
    elif opt_lag < 0:
        interp = f"{b_name} tends to lead {a_name} by {abs(opt_lag)} trading day{'s' if abs(opt_lag) != 1 else ''}. Price moves in {b_name} may predict future moves in {a_name}."
    else:
        interp = f"No significant lead-lag relationship detected. Both assets move roughly simultaneously."

    return CrossLagResult(
        cross_correlations=cross_corr,
        optimal_lag={"lag": opt_lag, "correlation": round(opt_corr, 4), "interpretation": interp},
        asset_a_name=a_name,
        asset_b_name=b_name,
    )


# ── POST /correlation/alerts ──────────────────────────────────────────────────


def _rolling_corr_pair(s_a: pd.Series, s_b: pd.Series, window: int, use_returns: bool) -> pd.Series:
    if use_returns:
        s_a = s_a.pct_change()
        s_b = s_b.pct_change()
    combined = pd.concat([s_a, s_b], axis=1).dropna()
    if combined.shape[1] < 2:
        return pd.Series(dtype=float)
    return combined.iloc[:, 0].rolling(window).corr(combined.iloc[:, 1]).dropna()


@router.post("/correlation/alerts", response_model=CorrelationAlertResult)
def run_correlation_alerts(req: CorrelationAlertRequest) -> CorrelationAlertResult:
    datasets = req.datasets
    if len(datasets) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 datasets.")

    # Build aligned price series
    series: Dict[str, pd.Series] = {}
    for ds in datasets:
        try:
            s = pd.Series(
                [float(v) for v in ds["values"]],
                index=pd.to_datetime(ds["dates"]),
                name=ds["name"],
            )
            series[ds["name"]] = s
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Bad dataset '{ds.get('name', '?')}': {exc}")

    names = list(series.keys())
    pair_alerts: List[dict] = []

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            name_a, name_b = names[i], names[j]
            rolling_corr = _rolling_corr_pair(series[name_a], series[name_b], req.window, req.use_returns)
            if len(rolling_corr) < req.window:
                continue

            mean_corr = float(rolling_corr.mean())
            std_corr  = float(rolling_corr.std())
            if std_corr < 1e-10:
                continue

            z_scores = (rolling_corr - mean_corr) / std_corr

            alert_periods: List[dict] = []
            in_alert = False
            alert_start = None

            for date, z in z_scores.items():
                if abs(z) > req.z_threshold and not in_alert:
                    in_alert = True
                    alert_start = date
                elif abs(z) <= req.z_threshold and in_alert:
                    in_alert = False
                    segment_z    = z_scores[alert_start:date]
                    segment_corr = rolling_corr[alert_start:date]
                    first_z = float(z_scores[alert_start]) if alert_start in z_scores.index else float(segment_z.iloc[0])
                    alert_periods.append({
                        "start":                   str(alert_start.date()),
                        "end":                     str(date.date()),
                        "direction":               "spike" if first_z > 0 else "breakdown",
                        "peak_z_score":            round(float(segment_z.abs().max()), 4),
                        "avg_correlation_during":  round(float(segment_corr.mean()), 4),
                        "normal_correlation":      round(mean_corr, 4),
                    })

            # Close open alert at end of series
            if in_alert and alert_start is not None:
                segment_z    = z_scores[alert_start:]
                segment_corr = rolling_corr[alert_start:]
                first_z = float(z_scores[alert_start]) if alert_start in z_scores.index else float(segment_z.iloc[0])
                alert_periods.append({
                    "start":                   str(alert_start.date()),
                    "end":                     str(z_scores.index[-1].date()),
                    "direction":               "spike" if first_z > 0 else "breakdown",
                    "peak_z_score":            round(float(segment_z.abs().max()), 4),
                    "avg_correlation_during":  round(float(segment_corr.mean()), 4),
                    "normal_correlation":      round(mean_corr, 4),
                })

            current_z = float(z_scores.iloc[-1])
            current_status = "alert" if abs(current_z) > req.z_threshold else "normal"

            if alert_periods:
                pair_alerts.append({
                    "pair":               f"{name_a} — {name_b}",
                    "asset_a":            name_a,
                    "asset_b":            name_b,
                    "normal_correlation": round(mean_corr, 4),
                    "alerts":             alert_periods,
                    "current_z_score":    round(current_z, 4),
                    "current_status":     current_status,
                })

    active_alerts    = [p for p in pair_alerts if p["current_status"] == "alert"]
    currently_anomalous = active_alerts
    total_alert_count = sum(len(p["alerts"]) for p in pair_alerts)

    most_unstable: Optional[dict] = None
    if pair_alerts:
        most_unstable = max(pair_alerts, key=lambda p: len(p["alerts"]))

    return CorrelationAlertResult(
        pair_alerts=pair_alerts,
        active_alerts=active_alerts,
        total_alert_count=total_alert_count,
        most_unstable_pair=most_unstable,
        currently_anomalous=currently_anomalous,
    )
