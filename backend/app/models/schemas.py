from typing import Optional, List, Literal
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class ErrorResponse(BaseModel):
    detail: str


class DatasetMeta(BaseModel):
    name: str
    rows: int
    columns: List[str]
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CommodityBase(BaseModel):
    symbol: str
    name: Optional[str] = None


class OHLCVRecord(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    adjClose: Optional[float] = None


class DateRange(BaseModel):
    start: str
    end: str


class DatasetMetadata(BaseModel):
    rowCount: int
    columns: List[str]
    uploadedAt: str
    currency: Optional[str] = None


class CommodityDataset(BaseModel):
    id: str
    name: str
    ticker: Optional[str] = None
    source: Literal["csv", "api"]
    records: List[OHLCVRecord]
    dateRange: DateRange
    metadata: DatasetMetadata


class ColumnSampleInfo(BaseModel):
    col_name: str
    detected_as: Optional[str] = None  # "date"|"open"|"high"|"low"|"close"|"volume"|"adjClose"|None
    samples: List[str]


class CSVUploadResponse(BaseModel):
    success: bool
    data: Optional[CommodityDataset] = None
    error: Optional[str] = None
    column_info: Optional[List[ColumnSampleInfo]] = None


class CommodityInfo(BaseModel):
    ticker: str
    name: str
    category: str
    currency: str


class FetchMarketRequest(BaseModel):
    tickers: List[str]
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    interval: str = "1d"


class FetchMarketResponse(BaseModel):
    datasets: List[CommodityDataset]
    warnings: List[str] = []
    errors: List[str] = []


# ── Analytics — Regression ────────────────────────────────────────────────────

class SeriesInput(BaseModel):
    name: str
    values: List[float]
    dates: List[str]


class RegressionRequest(BaseModel):
    dependent: SeriesInput
    independents: List[SeriesInput]
    confidence_level: float = 0.95


class CoefficientDetail(BaseModel):
    name: str
    value: float
    std_error: float
    t_statistic: float
    p_value: float
    ci_lower: float
    ci_upper: float


class RegressionResult(BaseModel):
    r_squared: float
    adj_r_squared: float
    f_statistic: float
    f_pvalue: float
    num_observations: int
    coefficients: List[CoefficientDetail]
    # Simple regression (1 independent) — populated when len(independents)==1
    scatter_data: List[dict]
    regression_line: dict
    confidence_band: List[dict]
    # Multi-variate — always populated
    actual_vs_predicted: List[dict]
    partial_regression_data: List[dict]
    residuals: List[dict]
    durbin_watson: float
    jarque_bera: dict
    dependent_name: str
    independent_names: List[str]
    # Multicollinearity
    vif_scores: List[dict]
    correlation_matrix: dict
    partial_f_tests: Optional[List[dict]] = None


# ── Analytics — Stepwise ──────────────────────────────────────────────────────

class StepwiseRequest(BaseModel):
    dependent: SeriesInput
    candidates: List[SeriesInput]
    method: str = "forward"
    p_enter: float = 0.05
    p_remove: float = 0.10


class StepwiseStep(BaseModel):
    step: int
    action: str
    variable: str
    r_squared: float
    aic: float
    p_value: float


class StepwiseResult(BaseModel):
    steps: List[StepwiseStep]
    final_model: RegressionResult
    excluded_variables: List[str]
    excluded_reasons: dict


# ── Analytics — Forecast ──────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    name: str
    values: List[float]
    dates: List[str]
    horizon: int = 30
    models: List[str] = ["arima", "ets", "linear"]
    confidence_level: float = 0.95
    train_test_split: float = 0.8


class ForecastPoint(BaseModel):
    date: str
    value: float
    ci_lower: Optional[float] = None
    ci_upper: Optional[float] = None
    trend_component: Optional[float] = None
    noise_std: Optional[float] = None


class BacktestMetrics(BaseModel):
    mape: float
    rmse: float
    mae: float
    theils_u: float


class BacktestResult(BaseModel):
    actual: List[ForecastPoint]
    predicted: List[ForecastPoint]
    metrics: BacktestMetrics


class ModelForecast(BaseModel):
    model_name: str
    display_name: str
    parameters: dict
    forecast_values: List[ForecastPoint]
    backtest: BacktestResult
    aic: Optional[float] = None
    bic: Optional[float] = None
    error: Optional[str] = None
    historical_decomposition: Optional[dict] = None


class ForecastResult(BaseModel):
    dataset_name: str
    models: List[ModelForecast]
    historical: List[ForecastPoint]
    best_model: str
    train_size: int
    test_size: int
    forecast_horizon: int


# ── Analytics — Rolling Regression ────────────────────────────────────────────

class RollingRegressionRequest(BaseModel):
    dependent: dict
    independent: dict
    window_sizes: List[int] = [30, 60, 90]


class RollingWindowPoint(BaseModel):
    date: str
    r_squared: float
    beta: float
    p_value: float
    intercept: float


class RollingWindow(BaseModel):
    window_size: int
    data: List[RollingWindowPoint]


class RollingRegressionResult(BaseModel):
    windows: List[RollingWindow]
    dependent_name: str
    independent_name: str


# ── Analytics — Structural Breaks ─────────────────────────────────────────────

class StructuralBreakRequest(BaseModel):
    dependent: dict
    independent: dict
    method: str = "all"
    chow_test_date: Optional[str] = None


class StructuralBreakResult(BaseModel):
    cusum: Optional[dict] = None
    chow: Optional[dict] = None
    dependent_name: str
    independent_name: str


# ── Scenario / Monte Carlo ─────────────────────────────────────────────────────

class DriverShock(BaseModel):
    name: str
    value: float
    impact_weight: float = 1.0


class ScenarioRequest(BaseModel):
    dataset_name: str
    current_price: float
    historical_returns: List[float]
    drivers: List[DriverShock]
    horizon_days: int = 90
    num_simulations: int = 1000
    confidence_levels: List[float] = [0.10, 0.50, 0.90]


class ScenarioResult(BaseModel):
    percentile_paths: dict
    forecast_dates: List[str]
    terminal_stats: dict
    terminal_histogram: dict
    current_price: float
    horizon_days: int
    num_simulations: int
    drivers_applied: List[dict]
    model_params: dict
    sample_paths: List[List[float]]


class ScenarioCompareRequest(BaseModel):
    scenarios: List[ScenarioRequest]
    scenario_names: List[str]


class ScenarioCompareResult(BaseModel):
    scenarios: List[dict]
    forecast_dates: List[str]


class SensitivityRequest(BaseModel):
    dataset_name: str
    current_price: float
    historical_returns: List[float]
    drivers: List[DriverShock]
    horizon_days: int = 90
    num_simulations: int = 500
    test_range: List[float] = [-30.0, -20.0, -10.0, 0.0, 10.0, 20.0, 30.0]


class SensitivityResult(BaseModel):
    tornado: List[dict]
    partial_dependence: List[dict]
    elasticities: List[dict]
    baseline_price: float
    current_price: float


class RiskMetricsRequest(BaseModel):
    current_price: float
    historical_returns: List[float]
    historical_prices: List[dict]
    horizon_days: int = 30
    confidence_levels: List[float] = [0.95, 0.99]
    num_simulations: int = 5000


class RiskMetricsResult(BaseModel):
    var_results: List[dict]
    cvar_results: List[dict]
    drawdown: dict
    stress_tests: List[dict]
    risk_summary: dict


class ReplayRequest(BaseModel):
    event_id: str
    dataset_name: str
    current_price: float
    historical_returns: List[float]
    full_historical_data: Optional[List[dict]] = None


class ReplayResult(BaseModel):
    event: dict
    simulated: ScenarioResult
    actual_path: Optional[List[dict]] = None
    simulated_vs_actual: Optional[dict] = None
