from typing import List, Optional
from datetime import date, timedelta

import numpy as np
from fastapi import APIRouter, HTTPException

from scipy.stats import norm as scipy_norm

from app.models.schemas import (
    DriverShock,
    ReplayRequest,
    ReplayResult,
    RiskMetricsRequest,
    RiskMetricsResult,
    ScenarioCompareRequest,
    ScenarioCompareResult,
    ScenarioRequest,
    ScenarioResult,
    SensitivityRequest,
    SensitivityResult,
)

router = APIRouter(tags=["scenario"])


# ── Historical Events Catalogue ───────────────────────────────────────────────

HISTORICAL_EVENTS = [
    {
        "id": "gfc_2008",
        "name": "2008 Global Financial Crisis",
        "period": "Sep 2008 — Mar 2009",
        "description": "Lehman collapse triggered global recession. Oil fell from $147 to $32. Gold initially dropped then surged as safe haven.",
        "drivers": [
            {"name": "Supply Disruption", "value": 5, "impact_weight": 1.0},
            {"name": "Demand Shift", "value": -35, "impact_weight": 1.0},
            {"name": "USD Index Change", "value": 15, "impact_weight": 1.0},
            {"name": "Inventory Change", "value": 20, "impact_weight": 1.0},
        ],
        "category": "Financial Crisis",
        "severity": "extreme",
        "actual_impact": {"oil": -78, "gold": -15, "copper": -65},
    },
    {
        "id": "covid_2020",
        "name": "COVID-19 Pandemic Crash",
        "period": "Feb 2020 — Apr 2020",
        "description": "Global lockdowns crashed demand. Oil went negative for the first time. Metals dropped sharply then recovered on stimulus.",
        "drivers": [
            {"name": "Supply Disruption", "value": 10, "impact_weight": 1.0},
            {"name": "Demand Shift", "value": -40, "impact_weight": 1.0},
            {"name": "USD Index Change", "value": 8, "impact_weight": 1.0},
            {"name": "Inventory Change", "value": 30, "impact_weight": 1.0},
        ],
        "category": "Pandemic",
        "severity": "extreme",
        "actual_impact": {"oil": -65, "gold": -12, "copper": -26},
    },
    {
        "id": "ukraine_2022",
        "name": "Russia-Ukraine War",
        "period": "Feb 2022 — Jun 2022",
        "description": "Russian invasion disrupted energy and grain supply chains. Oil and gas surged. Wheat hit all-time highs.",
        "drivers": [
            {"name": "Supply Disruption", "value": 35, "impact_weight": 1.0},
            {"name": "Demand Shift", "value": -5, "impact_weight": 1.0},
            {"name": "USD Index Change", "value": 10, "impact_weight": 1.0},
            {"name": "Inventory Change", "value": -15, "impact_weight": 1.0},
        ],
        "category": "Geopolitical",
        "severity": "high",
        "actual_impact": {"oil": 45, "gold": 8, "copper": -5},
    },
    {
        "id": "suez_2021",
        "name": "Suez Canal Blockage",
        "period": "Mar 2021",
        "description": "Ever Given container ship blocked the Suez Canal for 6 days, disrupting global trade routes.",
        "drivers": [
            {"name": "Supply Disruption", "value": 15, "impact_weight": 1.0},
            {"name": "Demand Shift", "value": 0, "impact_weight": 1.0},
            {"name": "USD Index Change", "value": 0, "impact_weight": 1.0},
            {"name": "Inventory Change", "value": -5, "impact_weight": 1.0},
        ],
        "category": "Supply Chain",
        "severity": "moderate",
        "actual_impact": {"oil": 6, "gold": 1, "copper": 3},
    },
    {
        "id": "opec_cut_2023",
        "name": "OPEC+ Production Cuts 2023",
        "period": "Apr 2023 — Dec 2023",
        "description": "Saudi Arabia led surprise production cuts of 1.66M bpd, later extended to support oil prices above $80.",
        "drivers": [
            {"name": "Supply Disruption", "value": 20, "impact_weight": 1.0},
            {"name": "Demand Shift", "value": 5, "impact_weight": 1.0},
            {"name": "USD Index Change", "value": -3, "impact_weight": 1.0},
            {"name": "Inventory Change", "value": -10, "impact_weight": 1.0},
        ],
        "category": "OPEC Policy",
        "severity": "moderate",
        "actual_impact": {"oil": 15, "gold": 5, "copper": 8},
    },
    {
        "id": "china_reopen_2023",
        "name": "China Reopening Rally",
        "period": "Nov 2022 — Jan 2023",
        "description": "China abandoned zero-COVID policy. Markets priced in massive demand recovery for commodities, especially copper and oil.",
        "drivers": [
            {"name": "Supply Disruption", "value": 0, "impact_weight": 1.0},
            {"name": "Demand Shift", "value": 25, "impact_weight": 1.0},
            {"name": "USD Index Change", "value": -8, "impact_weight": 1.0},
            {"name": "Inventory Change", "value": -10, "impact_weight": 1.0},
        ],
        "category": "Demand Shock",
        "severity": "high",
        "actual_impact": {"oil": 12, "gold": 18, "copper": 25},
    },
]

_EVENTS_BY_ID = {e["id"]: e for e in HISTORICAL_EVENTS}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _future_dates(horizon_days: int) -> List[str]:
    today = date.today()
    return [(today + timedelta(days=i + 1)).isoformat() for i in range(horizon_days)]


def _run_gbm(req: ScenarioRequest):
    """
    Geometric Brownian Motion simulation with driver-shock drift adjustment.
    Returns (simulations [n_sim x horizon], percentile_paths dict, terminal_prices).
    """
    returns = np.array(req.historical_returns, dtype=float)
    returns = returns[np.isfinite(returns)]

    if len(returns) < 10:
        raise HTTPException(
            status_code=400,
            detail="Need at least 10 historical return observations for simulation.",
        )

    mu = float(np.mean(returns))
    sigma = float(np.std(returns))

    # Aggregate driver shocks → daily drift adjustment
    total_shock = sum(d.value / 100.0 * d.impact_weight for d in req.drivers)
    daily_shock = total_shock / 252.0
    adjusted_mu = mu + daily_shock

    S0 = req.current_price
    n_sim = min(req.num_simulations, 5000)   # cap to avoid memory blow-up
    horizon = req.horizon_days

    rng = np.random.default_rng()
    # Vectorised GBM: shape (n_sim, horizon)
    Z = rng.standard_normal((n_sim, horizon))
    log_returns = (adjusted_mu - 0.5 * sigma ** 2) + sigma * Z
    # Cumulative product of exp(log_returns) × S0
    simulations = S0 * np.exp(np.cumsum(log_returns, axis=1))

    # Percentile paths
    percentile_paths: dict = {}
    for level in req.confidence_levels:
        key = f"P{int(round(level * 100))}"
        percentile_paths[key] = np.percentile(simulations, level * 100, axis=0).tolist()

    terminal_prices = simulations[:, -1]

    return simulations, percentile_paths, terminal_prices, mu, sigma, adjusted_mu


def _build_result(req: ScenarioRequest) -> ScenarioResult:
    simulations, percentile_paths, terminal_prices, mu, sigma, adjusted_mu = _run_gbm(req)

    S0 = req.current_price

    # Terminal stats
    terminal_stats = {
        "mean": float(np.mean(terminal_prices)),
        "median": float(np.median(terminal_prices)),
        "std": float(np.std(terminal_prices)),
        "p10": float(np.percentile(terminal_prices, 10)),
        "p25": float(np.percentile(terminal_prices, 25)),
        "p50": float(np.percentile(terminal_prices, 50)),
        "p75": float(np.percentile(terminal_prices, 75)),
        "p90": float(np.percentile(terminal_prices, 90)),
        "min": float(np.min(terminal_prices)),
        "max": float(np.max(terminal_prices)),
        "prob_above_current": float(np.mean(terminal_prices > S0) * 100),
        "prob_below_current": float(np.mean(terminal_prices <= S0) * 100),
    }

    # Terminal histogram (50 bins)
    counts, bin_edges = np.histogram(terminal_prices, bins=50)
    terminal_histogram = {
        "bins": [float((bin_edges[i] + bin_edges[i + 1]) / 2) for i in range(len(counts))],
        "counts": counts.tolist(),
        "bin_edges": bin_edges.tolist(),
    }

    # 20 random sample paths for spaghetti plot
    idx = np.random.choice(simulations.shape[0], size=min(20, simulations.shape[0]), replace=False)
    sample_paths = [simulations[i].tolist() for i in idx]

    model_params = {
        "base_mu": round(float(mu), 8),
        "base_sigma": round(float(sigma), 6),
        "adjusted_mu": round(float(adjusted_mu), 8),
        "annualized_vol": round(float(sigma * np.sqrt(252)) * 100, 4),
    }

    return ScenarioResult(
        percentile_paths=percentile_paths,
        forecast_dates=_future_dates(req.horizon_days),
        terminal_stats=terminal_stats,
        terminal_histogram=terminal_histogram,
        current_price=float(S0),
        horizon_days=req.horizon_days,
        num_simulations=simulations.shape[0],
        drivers_applied=[
            {"name": d.name, "value": d.value, "impact_weight": d.impact_weight}
            for d in req.drivers
        ],
        model_params=model_params,
        sample_paths=sample_paths,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/scenario/historical-events")
def get_historical_events() -> List[dict]:
    return HISTORICAL_EVENTS


@router.post("/scenario/replay", response_model=ReplayResult)
def replay_event(req: ReplayRequest) -> ReplayResult:
    event = _EVENTS_BY_ID.get(req.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Unknown event_id: {req.event_id!r}")

    if req.current_price <= 0:
        raise HTTPException(status_code=400, detail="current_price must be positive.")

    # Build a ScenarioRequest using the event's driver shocks
    drivers = [DriverShock(**d) for d in event["drivers"]]
    scenario_req = ScenarioRequest(
        dataset_name=req.dataset_name,
        current_price=req.current_price,
        historical_returns=req.historical_returns,
        drivers=drivers,
        horizon_days=90,
        num_simulations=1000,
    )
    simulated = _build_result(scenario_req)

    # ── Optional actual path comparison ──────────────────────────────────────────
    actual_path: Optional[List[dict]] = None
    simulated_vs_actual: Optional[dict] = None

    if req.full_historical_data and len(req.full_historical_data) >= 2:
        prices = req.full_historical_data
        # Use the last 90 data points as the "event window" for comparison
        window = prices[-90:] if len(prices) >= 90 else prices
        start_price = float(window[0]["close"])
        if start_price > 0:
            actual_path = [
                {
                    "date": row["date"],
                    "value": float(row["close"]),
                    "indexed": round(float(row["close"]) / start_price * 100, 4),
                }
                for row in window
            ]
            actual_return = (float(window[-1]["close"]) - start_price) / start_price * 100
            simulated_return = (
                (simulated.terminal_stats["p50"] - req.current_price) / req.current_price * 100
            )
            difference = simulated_return - actual_return
            simulated_vs_actual = {
                "simulated_return": round(simulated_return, 4),
                "actual_return": round(actual_return, 4),
                "difference": round(difference, 4),
            }

    return ReplayResult(
        event=event,
        simulated=simulated,
        actual_path=actual_path,
        simulated_vs_actual=simulated_vs_actual,
    )


@router.post("/scenario", response_model=ScenarioResult)
def run_scenario(req: ScenarioRequest) -> ScenarioResult:
    if req.current_price <= 0:
        raise HTTPException(status_code=400, detail="current_price must be positive.")
    if req.horizon_days < 1 or req.horizon_days > 365:
        raise HTTPException(status_code=400, detail="horizon_days must be between 1 and 365.")
    if req.num_simulations < 100:
        raise HTTPException(status_code=400, detail="num_simulations must be at least 100.")
    return _build_result(req)


def _gbm_p50(
    historical_returns: List[float],
    current_price: float,
    drivers: List[DriverShock],
    horizon_days: int,
    num_simulations: int,
    rng: np.random.Generator,
) -> float:
    """Run a minimal GBM and return the P50 terminal price."""
    returns = np.array(historical_returns, dtype=float)
    returns = returns[np.isfinite(returns)]
    mu = float(np.mean(returns))
    sigma = float(np.std(returns))
    total_shock = sum(d.value / 100.0 * d.impact_weight for d in drivers)
    adjusted_mu = mu + total_shock / 252.0
    n_sim = min(num_simulations, 2000)
    Z = rng.standard_normal((n_sim, horizon_days))
    log_r = (adjusted_mu - 0.5 * sigma ** 2) + sigma * Z
    terminal = current_price * np.exp(np.sum(log_r, axis=1))
    return float(np.percentile(terminal, 50))


@router.post("/scenario/sensitivity", response_model=SensitivityResult)
def run_sensitivity(req: SensitivityRequest) -> SensitivityResult:
    if req.current_price <= 0:
        raise HTTPException(status_code=400, detail="current_price must be positive.")
    if len(req.historical_returns) < 10:
        raise HTTPException(status_code=400, detail="Need at least 10 historical return observations.")

    rng = np.random.default_rng(42)  # Fixed seed for reproducibility across drivers

    # ── Baseline P50 ──────────────────────────────────────────────────────────
    baseline_price = _gbm_p50(
        req.historical_returns, req.current_price, req.drivers,
        req.horizon_days, req.num_simulations, rng,
    )

    # ── Tornado analysis ─────────────────────────────────────────────────────
    LOW_SHOCK = -30.0
    HIGH_SHOCK = 30.0
    tornado: List[dict] = []

    for i, driver in enumerate(req.drivers):
        # Low shock: set this driver to -30, others at baseline
        low_drivers = [
            DriverShock(name=d.name, value=LOW_SHOCK if j == i else d.value, impact_weight=d.impact_weight)
            for j, d in enumerate(req.drivers)
        ]
        high_drivers = [
            DriverShock(name=d.name, value=HIGH_SHOCK if j == i else d.value, impact_weight=d.impact_weight)
            for j, d in enumerate(req.drivers)
        ]
        price_low = _gbm_p50(req.historical_returns, req.current_price, low_drivers, req.horizon_days, req.num_simulations, rng)
        price_high = _gbm_p50(req.historical_returns, req.current_price, high_drivers, req.horizon_days, req.num_simulations, rng)
        swing = price_high - price_low
        tornado.append({
            "driver": driver.name,
            "low_value": LOW_SHOCK,
            "high_value": HIGH_SHOCK,
            "price_at_low": round(price_low, 4),
            "price_at_high": round(price_high, 4),
            "swing": round(abs(swing), 4),
            "baseline_price": round(baseline_price, 4),
            "negative_swing": round(price_low - baseline_price, 4),
            "positive_swing": round(price_high - baseline_price, 4),
        })

    tornado.sort(key=lambda x: x["swing"], reverse=True)

    # ── Partial dependence ───────────────────────────────────────────────────
    partial_dependence: List[dict] = []

    for i, driver in enumerate(req.drivers):
        curve = []
        for test_val in req.test_range:
            test_drivers = [
                DriverShock(name=d.name, value=test_val if j == i else d.value, impact_weight=d.impact_weight)
                for j, d in enumerate(req.drivers)
            ]
            p50 = _gbm_p50(req.historical_returns, req.current_price, test_drivers, req.horizon_days, req.num_simulations, rng)
            curve.append({"driver_value": float(test_val), "expected_price": round(p50, 4)})
        partial_dependence.append({"driver": driver.name, "curve": curve})

    # ── Elasticity (finite difference around baseline) ───────────────────────
    elasticities: List[dict] = []
    DELTA = 5.0  # ±5% perturbation

    for i, driver in enumerate(req.drivers):
        up_drivers = [
            DriverShock(name=d.name, value=(driver.value + DELTA) if j == i else d.value, impact_weight=d.impact_weight)
            for j, d in enumerate(req.drivers)
        ]
        dn_drivers = [
            DriverShock(name=d.name, value=(driver.value - DELTA) if j == i else d.value, impact_weight=d.impact_weight)
            for j, d in enumerate(req.drivers)
        ]
        p50_up = _gbm_p50(req.historical_returns, req.current_price, up_drivers, req.horizon_days, req.num_simulations, rng)
        p50_dn = _gbm_p50(req.historical_returns, req.current_price, dn_drivers, req.horizon_days, req.num_simulations, rng)

        if baseline_price > 0 and (2 * DELTA) > 0:
            pct_price_change = (p50_up - p50_dn) / baseline_price * 100.0
            pct_driver_change = 2 * DELTA
            elasticity = pct_price_change / pct_driver_change
        else:
            elasticity = 0.0

        elasticities.append({
            "driver": driver.name,
            "elasticity": round(float(elasticity), 6),
        })

    elasticities.sort(key=lambda x: abs(x["elasticity"]), reverse=True)

    return SensitivityResult(
        tornado=tornado,
        partial_dependence=partial_dependence,
        elasticities=elasticities,
        baseline_price=round(baseline_price, 4),
        current_price=float(req.current_price),
    )


@router.post("/scenario/compare", response_model=ScenarioCompareResult)
def compare_scenarios(req: ScenarioCompareRequest) -> ScenarioCompareResult:
    if len(req.scenarios) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 scenarios to compare.")
    if len(req.scenarios) != len(req.scenario_names):
        raise HTTPException(status_code=400, detail="scenarios and scenario_names must have the same length.")

    results = []
    forecast_dates: List[str] = []

    for name, scenario_req in zip(req.scenario_names, req.scenarios):
        result = _build_result(scenario_req)
        if not forecast_dates:
            forecast_dates = result.forecast_dates
        results.append({
            "name": name,
            "p10_terminal": result.terminal_stats["p10"],
            "p50_terminal": result.terminal_stats["p50"],
            "p90_terminal": result.terminal_stats["p90"],
            "percentile_paths": result.percentile_paths,
            "terminal_stats": result.terminal_stats,
            "model_params": result.model_params,
            "drivers_applied": result.drivers_applied,
        })

    return ScenarioCompareResult(scenarios=results, forecast_dates=forecast_dates)


# ── Risk Metrics & Stress Testing ─────────────────────────────────────────────

STRESS_SCENARIOS = [
    {"name": "Normal Market",    "vol_multiplier": 1.0, "drift_shift":  0.000},
    {"name": "High Volatility",  "vol_multiplier": 2.0, "drift_shift":  0.000},
    {"name": "Market Crash",     "vol_multiplier": 3.0, "drift_shift": -0.002},
    {"name": "Flash Crash",      "vol_multiplier": 5.0, "drift_shift": -0.005},
    {"name": "Sustained Rally",  "vol_multiplier": 1.5, "drift_shift":  0.001},
]


def _find_top_drawdowns(drawdowns: np.ndarray, dates: List[str], n: int = 5) -> List[dict]:
    """Identify the top-N distinct drawdown episodes."""
    in_dd = False
    episodes: List[dict] = []
    start_idx = 0
    peak_val = 0.0

    for i, dd in enumerate(drawdowns):
        if not in_dd and dd < 0:
            in_dd = True
            start_idx = i
            peak_val = dd
        elif in_dd:
            if dd < peak_val:
                peak_val = dd
            if dd == 0.0 or i == len(drawdowns) - 1:
                episodes.append({
                    "start_date": dates[start_idx],
                    "end_date": dates[i],
                    "depth_pct": round(float(peak_val) * 100, 2),
                    "duration_days": i - start_idx,
                })
                in_dd = False

    episodes.sort(key=lambda e: e["depth_pct"])
    return episodes[:n]


@router.post("/scenario/risk-metrics", response_model=RiskMetricsResult)
def calculate_risk_metrics(req: RiskMetricsRequest) -> RiskMetricsResult:
    if req.current_price <= 0:
        raise HTTPException(status_code=400, detail="current_price must be positive.")
    if len(req.historical_returns) < 20:
        raise HTTPException(status_code=400, detail="Need at least 20 historical return observations.")
    if len(req.historical_prices) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 historical price records.")

    rets = np.array(req.historical_returns, dtype=float)
    rets = rets[np.isfinite(rets)]
    mu = float(np.mean(rets))
    sigma = float(np.std(rets, ddof=1))
    horizon = req.horizon_days
    P = req.current_price
    rng = np.random.default_rng(0)

    # ── Monte Carlo terminal prices ────────────────────────────────────────────
    n_sim = min(req.num_simulations, 5000)
    Z = rng.standard_normal((n_sim, horizon))
    log_r = (mu - 0.5 * sigma ** 2) + sigma * Z
    terminal_prices = P * np.exp(np.sum(log_r, axis=1))
    terminal_returns = (terminal_prices - P) / P

    # ── VaR & CVaR ────────────────────────────────────────────────────────────
    var_results: List[dict] = []
    cvar_results: List[dict] = []
    sorted_hist = np.sort(rets)

    for cl in req.confidence_levels:
        alpha = 1.0 - cl
        z_score = float(scipy_norm.ppf(alpha))

        # Parametric (normal) VaR
        param_var = P * (mu * horizon + z_score * sigma * float(np.sqrt(horizon)))

        # Historical VaR — scale 1-day returns to horizon
        hist_idx = max(0, int(alpha * len(sorted_hist)) - 1)
        hist_var = P * float(sorted_hist[hist_idx]) * float(np.sqrt(horizon))

        # Monte Carlo VaR
        mc_var = P * float(np.percentile(terminal_returns, alpha * 100))

        var_results.append({
            "confidence": cl,
            "parametric_var": round(param_var, 4),
            "historical_var": round(hist_var, 4),
            "mc_var": round(mc_var, 4),
            "horizon_days": horizon,
        })

        # CVaR (Expected Shortfall) from MC
        var_threshold = float(np.percentile(terminal_returns, alpha * 100))
        tail = terminal_returns[terminal_returns <= var_threshold]
        cvar_val = P * float(np.mean(tail)) if len(tail) > 0 else mc_var
        cvar_results.append({
            "confidence": cl,
            "cvar": round(cvar_val, 4),
        })

    # ── Drawdown Analysis ──────────────────────────────────────────────────────
    price_arr = np.array([p["close"] for p in req.historical_prices], dtype=float)
    dd_dates  = [str(p["date"]) for p in req.historical_prices]
    cummax    = np.maximum.accumulate(price_arr)
    dd_series = (price_arr - cummax) / cummax  # values <= 0

    max_dd_idx   = int(np.argmin(dd_series))
    max_dd_pct   = float(dd_series[max_dd_idx]) * 100
    max_dd_value = float(price_arr[max_dd_idx] - cummax[max_dd_idx])
    max_dd_date  = dd_dates[max_dd_idx]

    # Recovery days from max drawdown
    post = dd_series[max_dd_idx:]
    recovered = np.where(post >= 0)[0]
    recovery_days: Optional[int] = int(recovered[0]) if len(recovered) > 0 else None

    current_dd_pct = float(dd_series[-1]) * 100

    dd_chart = [
        {"date": dd_dates[i], "drawdown_pct": round(float(dd_series[i]) * 100, 4)}
        for i in range(len(dd_series))
    ]
    top5 = _find_top_drawdowns(dd_series, dd_dates, n=5)

    drawdown = {
        "max_drawdown_pct": round(max_dd_pct, 4),
        "max_drawdown_date": max_dd_date,
        "max_drawdown_value": round(max_dd_value, 4),
        "current_drawdown_pct": round(current_dd_pct, 4),
        "recovery_days": recovery_days,
        "drawdown_series": dd_chart,
        "top_5_drawdowns": top5,
    }

    # ── Stress Test Matrix ─────────────────────────────────────────────────────
    stress_tests: List[dict] = []
    n_stress = 1000
    for sc in STRESS_SCENARIOS:
        vm   = sc["vol_multiplier"]
        ds   = sc["drift_shift"]
        Z_s  = rng.standard_normal((n_stress, horizon))
        log_rs = ((mu + ds) - 0.5 * (sigma * vm) ** 2) + (sigma * vm) * Z_s
        t_prices = P * np.exp(np.sum(log_rs, axis=1))
        t_rets   = (t_prices - P) / P
        max_loss_pct = float(np.percentile(t_rets, 1)) * 100
        prob_loss_gt10 = float(np.mean(t_rets < -0.10)) * 100
        stress_tests.append({
            "scenario":          sc["name"],
            "vol_multiplier":    vm,
            "p5_price":          round(float(np.percentile(t_prices, 5)), 4),
            "p50_price":         round(float(np.percentile(t_prices, 50)), 4),
            "max_loss_pct":      round(max_loss_pct, 4),
            "prob_loss_gt_10pct": round(prob_loss_gt10, 4),
        })

    # ── Risk Summary ──────────────────────────────────────────────────────────
    ann_vol = sigma * float(np.sqrt(252)) * 100          # %
    ann_ret = mu    * 252 * 100                           # %
    rf_rate = 0.05 * 100                                  # assume 5% risk-free
    sharpe  = (ann_ret - rf_rate) / ann_vol if ann_vol > 0 else 0.0

    neg_rets = rets[rets < 0]
    downside_dev = float(np.std(neg_rets, ddof=1)) * float(np.sqrt(252)) * 100 if len(neg_rets) > 1 else ann_vol
    sortino = (ann_ret - rf_rate) / downside_dev if downside_dev > 0 else 0.0

    if ann_vol < 15:
        rating = "Low"
    elif ann_vol < 30:
        rating = "Medium"
    elif ann_vol < 40:
        rating = "High"
    else:
        rating = "Very High"

    risk_summary = {
        "annualized_volatility": round(ann_vol, 4),
        "annualized_return":     round(ann_ret, 4),
        "sharpe_ratio":          round(sharpe, 4),
        "sortino_ratio":         round(sortino, 4),
        "risk_rating":           rating,
    }

    return RiskMetricsResult(
        var_results=var_results,
        cvar_results=cvar_results,
        drawdown=drawdown,
        stress_tests=stress_tests,
        risk_summary=risk_summary,
    )
