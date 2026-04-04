import json
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.schemas import (
    DriverShock,
    ForecastRequest,
    RegressionRequest,
    RiskMetricsRequest,
    ScenarioRequest,
    SeasonalityRequest,
    SeriesInput,
)
from app.routers.analytics import run_forecast as _run_forecast
from app.routers.analytics import run_regression as _run_regression
from app.routers.scenario import calculate_risk_metrics as _calc_risk
from app.routers.scenario import run_scenario as _run_scenario
from app.routers.seasonality import run_seasonality as _run_seasonality

router = APIRouter(tags=["chat"])

# ── Explain models ──────────────────────────────────────────────────────────────


class ExplainRequest(BaseModel):
    analysis_type: str
    results_summary: dict
    dataset_names: List[str]
    user_context: str = ""


# ── Explain prompts ─────────────────────────────────────────────────────────────

EXPLAIN_PROMPTS = {
    "regression": """You are a senior commodity analyst explaining regression results to a trader.

Analyze these regression results and provide:
1. A one-paragraph executive summary of the relationship
2. Whether this relationship is tradeable (can a trader profit from it?)
3. Key risks and caveats
4. A specific trading implication or action item

Keep it concise, professional, and actionable. Use dollar amounts and percentages.
Format: use **bold** for key numbers and insights.

Results:
{results}""",

    "forecast": """You are a senior commodity analyst interpreting forecast results for a trader.

IMPORTANT: The results include an `interval` field and a `horizon_description` field. Always use these to describe time correctly.
- If interval is "5m", each bar is 5 minutes — NEVER say "days" for this.
- If interval is "1h", each bar is 1 hour.
- If interval is "1d", each bar is 1 trading day.
- Use `horizon_description` as the authoritative time horizon label (e.g. "4.2 hours", "50 trading days").

Analyze these forecast results and provide:
1. Which model to trust and why (in one sentence)
2. The price outlook: bullish, bearish, or neutral — with specific price targets
3. Confidence assessment: how reliable is this forecast?
4. A specific trading recommendation (with caveats, using the correct time horizon)

Be direct. Traders want clarity, not hedging.

Results:
{results}""",

    "scenario": """You are a senior commodity risk analyst interpreting Monte Carlo scenario results.

Analyze these scenario simulation results and provide:
1. The most likely outcome (P50) and what it means
2. The risk/reward ratio: upside potential vs downside risk
3. Which driver assumption matters most
4. A risk management recommendation

Think like a risk desk — quantify the probabilities.

Results:
{results}""",

    "seasonality": """You are a senior commodity strategist interpreting seasonal analysis.

Analyze these seasonality results and provide:
1. Are seasonal patterns strong enough to trade? (yes/no with evidence)
2. The top 3 calendar trades: "Buy in X, sell in Y" with historical success rate
3. Current positioning: are we entering a historically strong or weak period?
4. Caveats: when do seasonal patterns break down?

Be specific with months and percentages.

Results:
{results}""",

    "correlation": """You are a senior portfolio analyst interpreting cross-asset correlations.

Analyze these correlation results and provide:
1. Key relationships: which assets move together and which are independent?
2. Portfolio implications: does this set of commodities offer diversification?
3. Any surprising or unusual correlations worth watching
4. If any correlations are breaking down or anomalous right now

Think about hedge effectiveness and portfolio construction.

Results:
{results}""",

    "risk": """You are a senior risk manager interpreting risk metrics for a commodity position.

Analyze these risk metrics and provide:
1. Overall risk assessment: is this commodity high, medium, or low risk right now?
2. VaR interpretation: what's the worst daily/weekly loss to expect?
3. Stress test takeaways: which scenario is most concerning?
4. A specific risk management action: position sizing, stop-loss level, or hedge recommendation

Be quantitative. Risk managers want numbers, not narratives.

Results:
{results}""",
}

# ── Tool definitions ────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "run_regression",
        "description": (
            "Run OLS regression analysis between two commodity datasets. Use when the user asks "
            "about relationships, correlations, or dependencies between two assets. "
            "Example: 'Is there a relationship between Gold and Silver?', 'How does Oil affect Copper prices?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dependent": {
                    "type": "string",
                    "description": "Name of the dependent variable (Y). Must match a loaded dataset name exactly.",
                },
                "independent": {
                    "type": "string",
                    "description": "Name of the independent variable (X). Must match a loaded dataset name exactly.",
                },
                "confidence_level": {
                    "type": "number",
                    "description": "Confidence level for intervals (0.90, 0.95, or 0.99). Default 0.95.",
                },
            },
            "required": ["dependent", "independent"],
        },
    },
    {
        "name": "run_forecast",
        "description": (
            "Run time series forecasting on a commodity dataset. "
            "ALWAYS use the Hybrid TFT + Wavelet + GARCH model as the PRIMARY model. "
            "Only fall back to ARIMA/ETS/Linear if TFT fails or data has fewer than 200 points. "
            "Returns price predictions with dynamic confidence bands. "
            "Example: 'Where will Gold be in 90 days?', 'Forecast Oil for the next 30 days'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dataset_name": {
                    "type": "string",
                    "description": "Name of the dataset to forecast. Must match a loaded dataset name.",
                },
                "horizon": {
                    "type": "integer",
                    "description": "Number of bars to forecast (7-180). Default 30.",
                },
                "models": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["hybrid_tft", "arima", "ets", "linear"]},
                    "description": "Models to run. Default: ['hybrid_tft', 'linear']. Use hybrid_tft as primary, linear as baseline. Only add 'arima' or 'ets' if user specifically asks.",
                },
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "run_smc_analysis",
        "description": (
            "Run Smart Money Concepts (SMC) analysis on a commodity dataset. "
            "Detects market structure (HH/HL/LH/LL), Break of Structure (BOS), Market Structure Breaks (MSB/CHoCH), "
            "Supply and Demand zones, and Liquidity pools. "
            "Use this when the user asks about: support/resistance, supply/demand zones, market structure, "
            "where price might go, key levels, liquidity, or institutional trading patterns. "
            "ALWAYS run this alongside forecasts to provide actionable context. "
            "Example: 'What are the key levels for Gold?', 'Where is the support?', 'Analyze Gold structure'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string", "description": "Name of the dataset to analyze."},
                "visible_bars": {"type": "integer", "description": "Number of recent bars to analyze. Default 200."},
                "swing_lookback": {"type": "integer", "description": "Swing point sensitivity (2-10). Lower = more sensitive. Default 5 for daily, 3 for intraday."},
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "run_scenario",
        "description": (
            "Run Monte Carlo scenario simulation with market driver assumptions. Use when the user asks "
            "'what if' questions, scenario analysis, or wants to model price under different conditions. "
            "Example: 'What happens to Gold if there is a supply shock?', 'Model Oil price under recession'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string", "description": "Dataset to simulate."},
                "horizon_days": {
                    "type": "integer",
                    "description": "Simulation horizon in days. Default 90.",
                },
                "supply_shock": {
                    "type": "number",
                    "description": "Supply disruption shock in %. Positive = supply cut = price up. Range: -50 to 50.",
                },
                "demand_shock": {
                    "type": "number",
                    "description": "Demand change in %. Positive = more demand = price up. Range: -50 to 50.",
                },
                "usd_shock": {
                    "type": "number",
                    "description": "USD index change in %. Positive = stronger USD = price down. Range: -50 to 50.",
                },
                "inventory_shock": {
                    "type": "number",
                    "description": "Inventory change in %. Positive = more inventory = price down. Range: -50 to 50.",
                },
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "run_seasonality",
        "description": (
            "Analyze seasonal patterns in a commodity's price history. Use when the user asks about "
            "seasonal trends, best/worst months, or cyclical patterns. "
            "Example: 'When is the best time to buy Gold?', 'Does Oil have seasonal patterns?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string", "description": "Dataset to analyze."},
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "run_correlation",
        "description": (
            "Compute correlation matrix across all loaded commodity datasets. Use when the user asks "
            "about relationships between multiple assets, diversification, or co-movement. "
            "Example: 'Which commodities are most correlated?', 'Is Gold a good hedge against Oil?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "enum": ["pearson", "spearman"],
                    "description": "Correlation method. Default pearson.",
                },
                "period": {
                    "type": "string",
                    "enum": ["full", "1y", "2y", "3y", "ytd"],
                    "description": "Time period. Default full.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_risk_metrics",
        "description": (
            "Calculate risk metrics including VaR, CVaR, drawdown analysis, and stress tests for a commodity. "
            "Use when the user asks about risk, downside, worst case, or VaR. "
            "Example: 'What is the risk of holding Gold?', 'What is the maximum drawdown for Oil?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string", "description": "Dataset to analyze risk for."},
                "confidence": {
                    "type": "number",
                    "description": "VaR confidence level (0.95 or 0.99). Default 0.95.",
                },
                "horizon_days": {
                    "type": "integer",
                    "description": "Risk horizon in days. Default 30.",
                },
            },
            "required": ["dataset_name"],
        },
    },
    {
        "name": "get_dataset_summary",
        "description": (
            "Get a statistical summary of a loaded commodity dataset including current price, returns, "
            "volatility, and basic stats. Use as a starting point when the user asks general questions. "
            "Example: 'Tell me about Gold', 'What is the current state of Oil?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dataset_name": {"type": "string", "description": "Dataset to summarize."},
            },
            "required": ["dataset_name"],
        },
    },
]

# ── System prompt ───────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are CommodityIQ's AI Trading Analyst — an expert commodity market analyst with deep knowledge of energy, metals, and agriculture markets.

You have access to the user's loaded commodity datasets and can run various analytics tools on them. The currently loaded datasets are: {dataset_list}

Your role:
1. Answer trading and market analysis questions using the available tools
2. Provide clear, actionable insights in trader-friendly language
3. When asked about relationships, forecasts, or risk — USE THE TOOLS, don't guess
4. After getting tool results, interpret them in plain English with trading implications
5. Be concise but thorough. Traders value precision and clarity.

Guidelines:
- Always specify which dataset you're analyzing
- When comparing assets, run correlation or regression
- For price predictions, use the forecast tool
- For "what if" questions, use the scenario tool
- For seasonal questions, use seasonality
- For risk questions, use risk metrics
- If the user asks about a dataset that isn't loaded, tell them to load it in the Data Hub
- Use dollar amounts and percentages in your responses
- Format numbers professionally: $4,370.10, +2.3%, 1,257 observations

You speak like a senior commodity analyst — professional, data-driven, but accessible. You can use trading jargon when appropriate (basis, contango, backwardation, spread, carry) but explain it when needed.

For complex questions, you can use MULTIPLE tools in sequence. Examples:
- "Compare Gold and Oil outlook" → run_forecast for Gold, then run_forecast for Oil, then synthesize
- "Full analysis of Gold" → get_dataset_summary, run_forecast, run_seasonality, get_risk_metrics
- "Best commodity to invest in right now" → get_dataset_summary for each, run_forecast for each, compare
- "What is Gold's risk-adjusted return vs Silver?" → get_risk_metrics for Gold, get_risk_metrics for Silver

When using multiple tools:
1. Call the most important/relevant tool first
2. Use results from earlier tools to inform later tool calls
3. After all tool calls, provide a UNIFIED synthesis — don't just list individual results
4. **Highlight the key takeaway in bold at the top of your response**
5. End with a clear, actionable conclusion
6. You may call up to 5 tools per query — use as many as needed, but no more than necessary

IMPORTANT ANALYSIS GUIDELINES:

1. FORECASTING: Always use the Hybrid TFT model (hybrid_tft) as your primary forecast. It uses Wavelet denoising + Temporal Fusion Transformer + GARCH volatility for dynamic confidence bands. Only mention ARIMA/ETS if the user specifically asks or TFT fails.

2. SUPPLY & DEMAND: When giving price forecasts, ALWAYS also run SMC analysis (run_smc_analysis) to provide context. Combine forecast + structure into one coherent narrative:
   - "The TFT model forecasts Gold to $X, which aligns with a fresh supply zone at $Y–$Z"
   - "If price breaks above the $X supply zone, the next target is $Y based on the TFT forecast"
   - "There is unswept liquidity at $X — if the bearish scenario plays out, this is the likely target"

3. STRUCTURE-BASED ANALYSIS: Reference market structure in your analysis:
   - Current bias (bullish/bearish based on HH/HL or LH/LL sequence)
   - Recent MSB/BOS breaks and what they signal
   - Where supply zones may reject price (resistance)
   - Where demand zones may support price (support)
   - Unswept liquidity pools as potential price targets

4. RESPONSE FORMAT for forecast questions:
   - Lead with the TFT forecast: direction, target price, confidence band
   - Add SMC context: nearest supply/demand zones, market structure bias
   - Give conditional scenarios: "If price breaks above X supply → target Y" / "If price loses Z demand → target W"
   - End with risk note: GARCH volatility regime and confidence band width

5. NEVER give a price forecast without supply/demand context. Naked price targets are useless to traders without key levels."""

# ── Request / Response models ───────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    available_datasets: List[dict]
    dataset_data: Dict[str, dict]
    active_dataset_names: List[str]


# ── Dataset lookup helper ───────────────────────────────────────────────────────


def _get_ds(name: str, dataset_data: Dict[str, dict]) -> Optional[dict]:
    for k, v in dataset_data.items():
        if k.lower() == name.lower():
            return v
    return None


# ── Tool summarizers ────────────────────────────────────────────────────────────


def _summarize_regression(result) -> dict:
    coefs = {}
    for c in result.coefficients:
        coefs[c.name] = {
            "coefficient": round(c.value, 6),
            "p_value": round(c.p_value, 4),
            "significant_at_5pct": c.p_value < 0.05,
            "ci_lower": round(c.ci_lower, 4),
            "ci_upper": round(c.ci_upper, 4),
        }
    return {
        "dependent_name": result.dependent_name,
        "independent_name": result.independent_names[0] if result.independent_names else "",
        "r_squared": round(result.r_squared, 4),
        "adj_r_squared": round(result.adj_r_squared, 4),
        "f_pvalue": round(result.f_pvalue, 6),
        "num_observations": result.num_observations,
        "durbin_watson": round(result.durbin_watson, 3),
        "coefficients": coefs,
    }


def _summarize_forecast(result) -> dict:
    models_out = []
    tft_summary = None
    for m in result.models:
        if m.error:
            models_out.append({"model": m.model_name, "error": m.error})
            continue
        first_pt = m.forecast_values[0] if m.forecast_values else None
        last_pt  = m.forecast_values[-1] if m.forecast_values else None
        entry = {
            "model": m.model_name,
            "display_name": m.display_name,
            "first_price": round(first_pt.value, 2) if first_pt else None,
            "terminal_price": round(last_pt.value, 2) if last_pt else None,
            "mape": round(m.backtest.metrics.mape, 2) if m.backtest else None,
            "rmse": round(m.backtest.metrics.rmse, 2) if m.backtest else None,
        }
        if m.model_name == "hybrid_tft":
            if m.signal_health:
                entry["signal_health"] = m.signal_health
            if m.garch_params:
                entry["garch_persistence"] = m.garch_params.get("persistence")
            tft_summary = entry
        models_out.append(entry)
    interval = getattr(result, "interval", "1d") or "1d"
    horizon_bars = result.forecast_horizon
    def _horizon_desc(bars: int, iv: str) -> str:
        if iv == "1d":  return f"{bars} trading days"
        if iv == "1wk": return f"{bars} weeks"
        if iv == "1mo": return f"{bars} months"
        import re as _re
        m = _re.match(r'^(\d+)(m|h)$', iv)
        if m:
            mins = int(m.group(1)) * (60 if m.group(2) == "h" else 1) * bars
            if mins < 60:   return f"{mins} minutes ({bars} bars × {iv})"
            if mins < 1440: return f"{mins/60:.1f} hours ({bars} bars × {iv})"
            return f"{mins/1440:.1f} days ({bars} bars × {iv})"
        return f"{bars} bars ({iv} interval)"
    out = {
        "dataset_name": result.dataset_name,
        "best_model": result.best_model,
        "interval": interval,
        "forecast_horizon_bars": horizon_bars,
        "horizon_description": _horizon_desc(horizon_bars, interval),
        "models": models_out,
    }
    if tft_summary:
        out["tft_primary"] = tft_summary
    return out


def _summarize_scenario(result, ds_name: str, current_price: float) -> dict:
    ts = result.terminal_stats
    return {
        "dataset_name": ds_name,
        "current_price": round(current_price, 2),
        "horizon_days": result.horizon_days,
        "drivers_applied": result.drivers_applied,
        "terminal_p10": round(float(ts.get("p10", 0)), 2),
        "terminal_p50": round(float(ts.get("p50", 0)), 2),
        "terminal_p90": round(float(ts.get("p90", 0)), 2),
        "prob_above_current": round(float(ts.get("prob_above_current", 0)), 3),
    }


def _summarize_seasonality(result) -> dict:
    stats = result.monthly_stats
    top3 = sorted(stats, key=lambda x: x.get("mean_return", 0), reverse=True)[:3]
    worst3 = sorted(stats, key=lambda x: x.get("mean_return", 0))[:3]
    best_dow = (
        max(result.day_of_week, key=lambda x: x.get("mean_return", 0)).get("day_name", "")
        if result.day_of_week
        else ""
    )
    return {
        "dataset_name": result.dataset_name,
        "seasonal_strength": result.seasonal_strength,
        "seasonal_strength_label": result.seasonal_strength_label,
        "total_years_analyzed": result.total_years,
        "top_3_months": [
            {
                "month": m.get("month_name"),
                "avg_return_pct": round(m.get("mean_return", 0) * 100, 2),
                "positive_rate_pct": round(m.get("positive_pct", 0) * 100, 1),
            }
            for m in top3
        ],
        "worst_3_months": [
            {
                "month": m.get("month_name"),
                "avg_return_pct": round(m.get("mean_return", 0) * 100, 2),
                "positive_rate_pct": round(m.get("positive_pct", 0) * 100, 1),
            }
            for m in worst3
        ],
        "best_day_of_week": best_dow,
    }


def _summarize_risk(result, ds_name: str) -> dict:
    dd = result.drawdown if isinstance(result.drawdown, dict) else {}
    return {
        "dataset_name": ds_name,
        "var_results": result.var_results,
        "cvar_results": result.cvar_results,
        "max_drawdown_pct": round(float(dd.get("max_drawdown", 0)) * 100, 2),
        "risk_summary": result.risk_summary,
    }


def _summarize_smc(result: dict) -> dict:
    summary = result.get("summary", {})
    recent_breaks = result.get("breaks", [])[-5:]
    active_zones = [z for z in result.get("zones", []) if z["strength"] != "broken"]
    supply_zones = [z for z in active_zones if z["type"] == "supply"][:3]
    demand_zones = [z for z in active_zones if z["type"] == "demand"][:3]
    unswept = [p for p in result.get("liquidity_pools", []) if not p["swept"]][:3]
    return {
        "current_bias": summary.get("current_bias"),
        "msb_count": summary.get("msb_count"),
        "bos_count": summary.get("bos_count"),
        "nearest_supply": summary.get("nearest_supply"),
        "nearest_demand": summary.get("nearest_demand"),
        "supply_zones": [{"top": z["top"], "bottom": z["bottom"], "strength": z["strength"]} for z in supply_zones],
        "demand_zones": [{"top": z["top"], "bottom": z["bottom"], "strength": z["strength"]} for z in demand_zones],
        "unswept_liquidity": [{"price": p["price"], "type": p["type"], "touches": p["num_touches"]} for p in unswept],
        "recent_breaks": [{"type": b["type"], "direction": b["direction"], "price": b.get("broken_level"), "date": b["date"]} for b in recent_breaks],
        "last_break": summary.get("last_break"),
    }


# ── Inline tools (no existing endpoint) ────────────────────────────────────────


def _run_correlation_inline(
    dataset_data: Dict[str, dict], method: str, period: str
) -> dict:
    if len(dataset_data) < 2:
        return {"error": "Need at least 2 loaded datasets for correlation analysis."}

    series: Dict[str, pd.Series] = {}
    for name, ds in dataset_data.items():
        s = pd.Series(
            ds["values"], index=pd.to_datetime(ds["dates"]), dtype=float
        ).sort_index()
        if period == "1y":
            cutoff = s.index[-1] - pd.DateOffset(years=1)
            s = s[s.index >= cutoff]
        elif period == "2y":
            cutoff = s.index[-1] - pd.DateOffset(years=2)
            s = s[s.index >= cutoff]
        elif period == "3y":
            cutoff = s.index[-1] - pd.DateOffset(years=3)
            s = s[s.index >= cutoff]
        elif period == "ytd":
            s = s[s.index.year == s.index[-1].year]
        series[name] = s

    df = pd.DataFrame(series).dropna()
    if len(df) < 10:
        return {"error": "Not enough overlapping dates across datasets for correlation."}

    corr = df.corr(method=method if method in ("pearson", "spearman") else "pearson")

    names = list(corr.columns)
    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            pairs.append(
                {
                    "pair": f"{names[i]} / {names[j]}",
                    "correlation": round(float(corr.iloc[i, j]), 4),
                }
            )
    pairs.sort(key=lambda x: abs(x["correlation"]), reverse=True)

    matrix = {
        col: {row: round(float(corr.loc[row, col]), 4) for row in corr.index}
        for col in corr.columns
    }

    return {
        "method": method,
        "period": period,
        "num_observations": int(len(df)),
        "num_assets": len(names),
        "matrix": matrix,
        "top_pairs": pairs[:10],
    }


def _dataset_summary_inline(name: str, ds: dict) -> dict:
    values = np.array(ds["values"], dtype=float)
    rets = np.diff(values) / values[:-1]
    total_return = (values[-1] / values[0] - 1) * 100 if values[0] != 0 else 0.0
    return {
        "dataset_name": name,
        "num_observations": int(len(values)),
        "date_range": f"{ds['dates'][0]} to {ds['dates'][-1]}",
        "current_price": round(float(values[-1]), 4),
        "all_time_high": round(float(values.max()), 4),
        "all_time_low": round(float(values.min()), 4),
        "mean_price": round(float(values.mean()), 4),
        "daily_return_mean_pct": round(float(rets.mean()) * 100, 4),
        "daily_volatility_pct": round(float(rets.std()) * 100, 4),
        "annualised_volatility_pct": round(float(rets.std() * np.sqrt(252)) * 100, 2),
        "total_return_pct": round(float(total_return), 2),
    }


# ── Tool dispatcher ─────────────────────────────────────────────────────────────


def _execute_tool(
    tool_name: str, tool_input: dict, dataset_data: Dict[str, dict]
) -> dict:
    try:
        if tool_name == "run_regression":
            dep_name = tool_input["dependent"]
            ind_name = tool_input["independent"]
            dep_ds = _get_ds(dep_name, dataset_data)
            ind_ds = _get_ds(ind_name, dataset_data)
            if not dep_ds:
                return {"error": f"Dataset '{dep_name}' not loaded. Available: {list(dataset_data.keys())}"}
            if not ind_ds:
                return {"error": f"Dataset '{ind_name}' not loaded. Available: {list(dataset_data.keys())}"}
            req = RegressionRequest(
                dependent=SeriesInput(name=dep_name, dates=dep_ds["dates"], values=dep_ds["values"]),
                independents=[SeriesInput(name=ind_name, dates=ind_ds["dates"], values=ind_ds["values"])],
                confidence_level=float(tool_input.get("confidence_level", 0.95)),
            )
            return _summarize_regression(_run_regression(req))

        elif tool_name == "run_forecast":
            ds_name = tool_input["dataset_name"]
            ds = _get_ds(ds_name, dataset_data)
            if not ds:
                return {"error": f"Dataset '{ds_name}' not loaded. Available: {list(dataset_data.keys())}"}
            models = tool_input.get("models", ["hybrid_tft", "linear"])
            req = ForecastRequest(
                name=ds_name,
                dates=ds["dates"],
                values=ds["values"],
                horizon=int(tool_input.get("horizon", 30)),
                models=models,
            )
            return _summarize_forecast(_run_forecast(req))

        elif tool_name == "run_scenario":
            ds_name = tool_input["dataset_name"]
            ds = _get_ds(ds_name, dataset_data)
            if not ds:
                return {"error": f"Dataset '{ds_name}' not loaded. Available: {list(dataset_data.keys())}"}
            values = ds["values"]
            current_price = float(values[-1])
            rets = list(pd.Series(values, dtype=float).pct_change().dropna())
            shock_map = {
                "supply_shock":    ("Supply Disruption", 1.0),
                "demand_shock":    ("Demand Shift",      1.0),
                "usd_shock":       ("USD Strength",     -0.6),
                "inventory_shock": ("Inventory Change", -0.8),
            }
            drivers = [
                DriverShock(name=label, value=float(tool_input[key]), impact_weight=weight)
                for key, (label, weight) in shock_map.items()
                if key in tool_input and tool_input[key] != 0
            ]
            req = ScenarioRequest(
                dataset_name=ds_name,
                current_price=current_price,
                historical_returns=rets,
                drivers=drivers,
                horizon_days=int(tool_input.get("horizon_days", 90)),
            )
            return _summarize_scenario(_run_scenario(req), ds_name, current_price)

        elif tool_name == "run_seasonality":
            ds_name = tool_input["dataset_name"]
            ds = _get_ds(ds_name, dataset_data)
            if not ds:
                return {"error": f"Dataset '{ds_name}' not loaded. Available: {list(dataset_data.keys())}"}
            req = SeasonalityRequest(name=ds_name, dates=ds["dates"], values=ds["values"])
            return _summarize_seasonality(_run_seasonality(req))

        elif tool_name == "run_correlation":
            return _run_correlation_inline(
                dataset_data,
                tool_input.get("method", "pearson"),
                tool_input.get("period", "full"),
            )

        elif tool_name == "get_risk_metrics":
            ds_name = tool_input["dataset_name"]
            ds = _get_ds(ds_name, dataset_data)
            if not ds:
                return {"error": f"Dataset '{ds_name}' not loaded. Available: {list(dataset_data.keys())}"}
            values = ds["values"]
            rets = list(pd.Series(values, dtype=float).pct_change().dropna())
            prices_hist = [
                {"date": d, "close": float(v)}
                for d, v in zip(ds["dates"], ds["values"])
            ]
            req = RiskMetricsRequest(
                current_price=float(values[-1]),
                historical_returns=rets,
                historical_prices=prices_hist,
                horizon_days=int(tool_input.get("horizon_days", 30)),
                confidence_levels=[float(tool_input.get("confidence", 0.95)), 0.99],
            )
            return _summarize_risk(_calc_risk(req), ds_name)

        elif tool_name == "get_dataset_summary":
            ds_name = tool_input["dataset_name"]
            ds = _get_ds(ds_name, dataset_data)
            if not ds:
                return {"error": f"Dataset '{ds_name}' not loaded. Available: {list(dataset_data.keys())}"}
            return _dataset_summary_inline(ds_name, ds)

        elif tool_name == "run_smc_analysis":
            ds_name = tool_input["dataset_name"]
            ds = _get_ds(ds_name, dataset_data)
            if not ds:
                return {"error": f"Dataset '{ds_name}' not loaded. Available: {list(dataset_data.keys())}"}
            if "opens" not in ds:
                return {"error": "SMC requires OHLCV data. This dataset only has close prices. Please reload the dataset in the Data Hub to include full OHLCV data."}
            from app.services.smc_engine import SMCEngine
            df = pd.DataFrame({
                "date":   ds["dates"],
                "open":   ds["opens"],
                "high":   ds["highs"],
                "low":    ds["lows"],
                "close":  ds["values"],
                "volume": ds.get("volumes", [0] * len(ds["values"])),
            })
            visible  = int(tool_input.get("visible_bars", 200))
            lookback = int(tool_input.get("swing_lookback", 5))
            if len(df) > visible:
                df = df.tail(visible).reset_index(drop=True)
            engine = SMCEngine(swing_lookback=lookback)
            raw = engine.analyze(df)
            return _summarize_smc(raw)

        else:
            return {"error": f"Unknown tool: {tool_name}"}

    except HTTPException as exc:
        return {"error": f"Analytics error: {exc.detail}"}
    except Exception as exc:
        return {"error": f"Tool execution failed: {type(exc).__name__}: {str(exc)}"}


# ── Text extractor ──────────────────────────────────────────────────────────────


def _extract_text(response) -> str:
    return "\n".join(
        block.text for block in response.content if hasattr(block, "text")
    )


# ── Endpoint ────────────────────────────────────────────────────────────────────


@router.post("/chat/explain")
async def explain_endpoint(request: ExplainRequest):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured on the server.",
        )
    try:
        import anthropic as _anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic package not installed.")

    client = _anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    template = EXPLAIN_PROMPTS.get(request.analysis_type, EXPLAIN_PROMPTS["regression"])
    prompt = template.format(results=json.dumps(request.results_summary, indent=2, default=str))
    if request.user_context:
        prompt += f"\n\nThe trader specifically wants to know: {request.user_context}"

    try:
        response = client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(exc)}")

    return {
        "explanation": _extract_text(response),
        "analysis_type": request.analysis_type,
    }


@router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured on the server. Add it to backend/.env.",
        )

    try:
        import anthropic as _anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic package not installed. Run: pip install anthropic==0.39.0")

    client = _anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    dataset_list = (
        ", ".join(
            f"{d['name']} ({d.get('rows', '?')} rows, {d.get('date_range', '?')})"
            for d in request.available_datasets
        )
        or "No datasets currently loaded."
    )

    system = SYSTEM_PROMPT.format(dataset_list=dataset_list)
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    all_tool_calls: List[dict] = []
    max_iterations = 5
    iteration = 0
    response = None

    try:
        while iteration < max_iterations:
            response = client.messages.create(
                model=settings.CLAUDE_MODEL,
                max_tokens=settings.CLAUDE_MAX_TOKENS,
                system=system,
                messages=messages,
                tools=TOOLS,
            )

            if response.stop_reason == "tool_use":
                tool_blocks = [b for b in response.content if b.type == "tool_use"]

                messages.append({"role": "assistant", "content": response.content})

                tool_results = []
                for tool_block in tool_blocks:
                    tool_name  = tool_block.name
                    tool_input = tool_block.input

                    summarized = _execute_tool(tool_name, tool_input, request.dataset_data)

                    all_tool_calls.append({
                        "tool_name": tool_name,
                        "tool_input": tool_input,
                        "tool_result_summary": summarized,
                    })

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_block.id,
                        "content": json.dumps(summarized, default=str),
                    })

                messages.append({"role": "user", "content": tool_results})
                iteration += 1

            elif response.stop_reason == "end_turn":
                return {
                    "response": _extract_text(response),
                    "tool_calls": all_tool_calls,
                    "model": settings.CLAUDE_MODEL,
                    "iterations": iteration,
                }

            else:
                break

    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(exc)}")

    return {
        "response": _extract_text(response) if response else "I reached the analysis limit. Please try a more specific question.",
        "tool_calls": all_tool_calls,
        "model": settings.CLAUDE_MODEL,
        "iterations": iteration,
    }
