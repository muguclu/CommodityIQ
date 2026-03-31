import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  faz: number;
  status: "active" | "coming-soon";
}

export interface FeatureCard {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  faz: number;
  status: "active" | "coming-soon";
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export type TrendDirection = "up" | "down" | "flat";

export interface MetricCard {
  label: string;
  value: string | number;
  change?: number;
  direction?: TrendDirection;
  unit?: string;
}

export interface ApiError {
  detail: string;
}

export interface OHLCVRecord {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export interface CommodityDataset {
  id: string;
  name: string;
  ticker?: string;
  source: "csv" | "api";
  interval?: DataInterval;
  records: OHLCVRecord[];
  dateRange: {
    start: string;
    end: string;
  };
  metadata: {
    rowCount: number;
    columns: string[];
    uploadedAt: string;
    currency?: string;
  };
}

export interface ColumnMapping {
  date: string;
  open?: string;
  high?: string;
  low?: string;
  close: string;
  volume?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CommodityInfo {
  ticker: string;
  name: string;
  category: "Energy" | "Metals" | "Agriculture";
  currency: string;
}

export type DataInterval = "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";

export interface FetchMarketRequest {
  tickers: string[];
  start_date?: string;
  end_date?: string;
  interval?: DataInterval;
}

export interface FetchMarketResponse {
  datasets: CommodityDataset[];
  warnings: string[];
  errors: string[];
}

export interface SeriesInput {
  name: string;
  values: number[];
  dates: string[];
}

export interface RegressionRequest {
  dependent: SeriesInput;
  independents: SeriesInput[];
  confidence_level?: number;
}

export interface CoefficientDetail {
  name: string;
  value: number;
  std_error: number;
  t_statistic: number;
  p_value: number;
  ci_lower: number;
  ci_upper: number;
}

export interface RegressionResult {
  r_squared: number;
  adj_r_squared: number;
  f_statistic: number;
  f_pvalue: number;
  num_observations: number;
  coefficients: CoefficientDetail[];
  scatter_data: { x: number; y: number; date: string }[];
  regression_line: { x_min: number; x_max: number; y_min: number; y_max: number };
  confidence_band: { x: number; y_lower: number; y_upper: number }[];
  actual_vs_predicted: { date: string; actual: number; predicted: number }[];
  partial_regression_data: { name: string; data: { x_partial: number; y_partial: number }[] }[];
  residuals: { date: string; value: number; predicted: number; residual: number }[];
  durbin_watson: number;
  jarque_bera: { statistic: number; p_value: number };
  dependent_name: string;
  independent_names: string[];
  vif_scores: { name: string; vif: number }[];
  correlation_matrix: { columns: string[]; values: number[][] };
  partial_f_tests: { variable: string; f_stat: number; p_value: number }[] | null;
}

export interface StepwiseRequest {
  dependent: SeriesInput;
  candidates: SeriesInput[];
  method?: string;
  p_enter?: number;
  p_remove?: number;
}

export interface StepwiseStep {
  step: number;
  action: string;
  variable: string;
  r_squared: number;
  aic: number;
  p_value: number;
}

export interface StepwiseResult {
  steps: StepwiseStep[];
  final_model: RegressionResult;
  excluded_variables: string[];
  excluded_reasons: Record<string, string>;
}

// ── Forecast ──────────────────────────────────────────────────────────────────

export interface ForecastRequest {
  name: string;
  values: number[];
  dates: string[];
  horizon?: number;
  models?: string[];
  confidence_level?: number;
  train_test_split?: number;
}

export interface ForecastPoint {
  date: string;
  value: number;
  ci_lower?: number;
  ci_upper?: number;
  trend_component?: number;
  noise_std?: number;
}

export interface BacktestMetrics {
  mape: number;
  rmse: number;
  mae: number;
  theils_u: number;
}

export interface BacktestResult {
  actual: ForecastPoint[];
  predicted: ForecastPoint[];
  metrics: BacktestMetrics;
}

export interface ModelForecast {
  model_name: string;
  display_name: string;
  parameters: Record<string, unknown>;
  forecast_values: ForecastPoint[];
  backtest: BacktestResult;
  aic?: number;
  bic?: number;
  error?: string;
  signal_health?: {
    snr_db: number;
    noise_normality: string;
    garch_persistence: number | null;
    volatility_regime: string | null;
    tft_available: boolean;
    tft_trained: boolean;
    ci_type: string;
  };
  garch_params?: {
    fitted: boolean;
    parameters?: { omega: number; alpha: number; beta: number; persistence: number };
    conditional_volatility_latest?: number;
  };
  tft_metrics?: {
    trained: boolean;
    val_mape?: number;
    val_rmse?: number;
    epochs?: number;
    error?: string;
  };
  historical_decomposition?: {
    dates: string[];
    original: number[];
    trend: number[];
    noise: number[];
    garch_vol: (number | null)[];
  };
}

export interface ForecastResult {
  dataset_name: string;
  models: ModelForecast[];
  historical: ForecastPoint[];
  best_model: string;
  train_size: number;
  test_size: number;
  forecast_horizon: number;
}

// ── Rolling Regression ────────────────────────────────────────────────────────

export interface SeriesDict {
  name: string;
  values: number[];
  dates: string[];
}

export interface RollingRegressionRequest {
  dependent: SeriesDict;
  independent: SeriesDict;
  window_sizes?: number[];
}

export interface RollingWindowPoint {
  date: string;
  r_squared: number;
  beta: number;
  p_value: number;
  intercept: number;
}

export interface RollingWindow {
  window_size: number;
  data: RollingWindowPoint[];
}

export interface RollingRegressionResult {
  windows: RollingWindow[];
  dependent_name: string;
  independent_name: string;
}

// ── Structural Breaks ─────────────────────────────────────────────────────────

export interface StructuralBreakRequest {
  dependent: SeriesDict;
  independent: SeriesDict;
  method?: "cusum" | "chow" | "all";
  chow_test_date?: string | null;
}

export interface CusumPoint {
  date: string;
  cusum: number;
}

export interface ChowTest {
  date: string;
  f_statistic: number;
  p_value: number;
}

export interface StructuralBreakResult {
  cusum: {
    values: CusumPoint[];
    upper_bound: number;
    lower_bound: number;
    breaks_detected: { date: string; cusum_value: number }[];
    error?: string;
  } | null;
  chow: {
    tests: ChowTest[];
    most_significant: ChowTest | null;
    breaks_detected: ChowTest[];
  } | null;
  dependent_name: string;
  independent_name: string;
}

// ── Scenario / Monte Carlo ─────────────────────────────────────────────────────

export interface DriverShock {
  name: string;
  value: number;
  impact_weight: number;
}

export interface ScenarioRequest {
  dataset_name: string;
  current_price: number;
  historical_returns: number[];
  drivers: DriverShock[];
  horizon_days?: number;
  num_simulations?: number;
  confidence_levels?: number[];
}

export interface ScenarioResult {
  percentile_paths: Record<string, number[]>;
  forecast_dates: string[];
  terminal_stats: {
    mean: number;
    median: number;
    std: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    min: number;
    max: number;
    prob_above_current: number;
    prob_below_current: number;
  };
  terminal_histogram: {
    bins: number[];
    counts: number[];
    bin_edges: number[];
  };
  current_price: number;
  horizon_days: number;
  num_simulations: number;
  drivers_applied: { name: string; value: number; impact_weight: number }[];
  model_params: {
    base_mu: number;
    base_sigma: number;
    adjusted_mu: number;
    annualized_vol: number;
  };
  sample_paths: number[][];
}

export interface ScenarioCompareRequest {
  scenarios: ScenarioRequest[];
  scenario_names: string[];
}

export interface ScenarioCompareScenario {
  name: string;
  p10_terminal: number;
  p50_terminal: number;
  p90_terminal: number;
  percentile_paths: Record<string, number[]>;
  terminal_stats: ScenarioResult["terminal_stats"];
  model_params: ScenarioResult["model_params"];
  drivers_applied: ScenarioResult["drivers_applied"];
}

export interface ScenarioCompareResult {
  scenarios: ScenarioCompareScenario[];
  forecast_dates: string[];
}

export interface SensitivityRequest {
  dataset_name: string;
  current_price: number;
  historical_returns: number[];
  drivers: DriverShock[];
  horizon_days?: number;
  num_simulations?: number;
  test_range?: number[];
}

export interface TornadoEntry {
  driver: string;
  low_value: number;
  high_value: number;
  price_at_low: number;
  price_at_high: number;
  swing: number;
  baseline_price: number;
  negative_swing: number;
  positive_swing: number;
}

export interface PDPCurvePoint {
  driver_value: number;
  expected_price: number;
}

export interface PDPEntry {
  driver: string;
  curve: PDPCurvePoint[];
}

export interface ElasticityEntry {
  driver: string;
  elasticity: number;
}

export interface SensitivityResult {
  tornado: TornadoEntry[];
  partial_dependence: PDPEntry[];
  elasticities: ElasticityEntry[];
  baseline_price: number;
  current_price: number;
}

export interface VarEntry {
  confidence: number;
  parametric_var: number;
  historical_var: number;
  mc_var: number;
  horizon_days: number;
}

export interface CvarEntry {
  confidence: number;
  cvar: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown_pct: number;
}

export interface DrawdownEpisode {
  start_date: string;
  end_date: string;
  depth_pct: number;
  duration_days: number;
}

export interface DrawdownData {
  max_drawdown_pct: number;
  max_drawdown_date: string;
  max_drawdown_value: number;
  current_drawdown_pct: number;
  recovery_days: number | null;
  drawdown_series: DrawdownPoint[];
  top_5_drawdowns: DrawdownEpisode[];
}

export interface StressTestEntry {
  scenario: string;
  vol_multiplier: number;
  p5_price: number;
  p50_price: number;
  max_loss_pct: number;
  prob_loss_gt_10pct: number;
}

export interface RiskSummary {
  annualized_volatility: number;
  annualized_return: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  risk_rating: "Low" | "Medium" | "High" | "Very High";
}

export interface RiskMetricsRequest {
  current_price: number;
  historical_returns: number[];
  historical_prices: Array<{ date: string; close: number }>;
  horizon_days?: number;
  confidence_levels?: number[];
  num_simulations?: number;
}

export interface RiskMetricsResult {
  var_results: VarEntry[];
  cvar_results: CvarEntry[];
  drawdown: DrawdownData;
  stress_tests: StressTestEntry[];
  risk_summary: RiskSummary;
}

export interface HistoricalEventDriver {
  name: string;
  value: number;
  impact_weight: number;
}

export interface HistoricalEvent {
  id: string;
  name: string;
  period: string;
  description: string;
  drivers: HistoricalEventDriver[];
  category: string;
  severity: "extreme" | "high" | "moderate";
  actual_impact: Record<string, number>;
}

export interface ReplayRequest {
  event_id: string;
  dataset_name: string;
  current_price: number;
  historical_returns: number[];
  full_historical_data?: Array<{ date: string; close: number }>;
}

export interface ReplayActualPoint {
  date: string;
  value: number;
  indexed: number;
}

export interface ReplayResult {
  event: HistoricalEvent;
  simulated: ScenarioResult;
  actual_path: ReplayActualPoint[] | null;
  simulated_vs_actual: {
    simulated_return: number;
    actual_return: number;
    difference: number;
  } | null;
}
