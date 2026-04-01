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
  interval?: string;
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
  interval?: string;
  horizon_real_time?: string;
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

// ── SMC (Smart Money Concepts) ────────────────────────────────────────────────

export interface SMCCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SwingPoint {
  index: number;
  date: string;
  price: number;
  type: "high" | "low";
  strength: number;
}

export interface StructurePoint {
  index: number;
  date: string;
  price: number;
  label: "HH" | "HL" | "LH" | "LL";
  trend: "bullish" | "bearish";
}

export interface StructureBreak {
  index: number;
  date: string;
  price: number;
  type: "BOS" | "MSB";
  direction: "bullish" | "bearish";
  broken_level: number;
  description: string;
}

export interface SDZone {
  start_index: number;
  end_index: number;
  start_date: string;
  end_date: string;
  top: number;
  bottom: number;
  type: "supply" | "demand";
  strength: "fresh" | "tested" | "broken";
  origin_candle: { date: string; open: number; high: number; low: number; close: number };
}

export interface LiquidityPool {
  index: number;
  date: string;
  price: number;
  type: "EQH" | "EQL" | "BSL" | "SSL";
  num_touches: number;
  swept: boolean;
  swept_date: string | null;
}

export interface SMCSummary {
  current_bias: "bullish" | "bearish";
  total_swing_points: number;
  total_breaks: number;
  msb_count: number;
  bos_count: number;
  active_supply_zones: number;
  active_demand_zones: number;
  unswept_liquidity: number;
  nearest_supply: number | null;
  nearest_demand: number | null;
  last_break: StructureBreak | null;
}

export interface SMCRequest {
  name: string;
  dates: string[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  interval: string;
  swing_lookback?: number;
  visible_bars?: number;
}

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
  tool_calls?: AIToolCall[];
  timestamp?: string;
  iterations?: number;
  elapsed_ms?: number;
}

export interface AIToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result_summary: Record<string, unknown>;
}

export interface ChatRequest {
  messages: AIChatMessage[];
  available_datasets: Array<{ name: string; ticker?: string; rows: number; date_range: string }>;
  dataset_data: Record<string, { dates: string[]; values: number[] }>;
  active_dataset_names: string[];
}

export interface ChatResponse {
  response: string;
  tool_calls: AIToolCall[];
  model: string;
  iterations?: number;
}

export interface SeasonalSignalRequest {
  name: string;
  dates: string[];
  values: number[];
  positive_threshold?: number;
  negative_threshold?: number;
  min_years?: number;
}

export interface CalendarSignal {
  month: number;
  month_name: string;
  signal: "strong" | "weak" | "neutral";
  avg_return: number;
  positive_pct: number;
  confidence: "high" | "low";
}

export interface StrategyMetrics {
  annual_return: number;
  annual_volatility: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_return: number;
  num_trades: number;
}

export interface SeasonalSignalResult {
  strong_months: number[];
  weak_months: number[];
  neutral_months: number[];
  calendar_signals: CalendarSignal[];
  equity_curves: {
    dates: string[];
    seasonal_strategy: number[];
    buy_and_hold: number[];
  };
  seasonal_metrics: StrategyMetrics;
  buyhold_metrics: StrategyMetrics;
  strategy_description: string;
  outperformance: number;
  dataset_name: string;
}

export interface YoYRequest {
  name: string;
  dates: string[];
  values: number[];
  years_to_show?: number;
  normalize?: boolean;
}

export interface YoYYearSummary {
  year: number;
  ytd_return: number;
  max_value: number;
  min_value: number;
  final_value: number;
  trading_days: number;
}

export interface YoYMeanBandEntry {
  trading_day: number;
  mean: number;
  std: number;
  upper: number;
  lower: number;
}

export interface YoYResult {
  years_data: Record<string, { trading_day: number; value: number }[]>;
  mean_band: YoYMeanBandEntry[];
  current_year: number;
  normalized: boolean;
  dataset_name: string;
  year_summaries: YoYYearSummary[];
}

export interface SeasonalityRequest {
  name: string;
  dates: string[];
  values: number[];
  period?: number;
  frequency?: string;
}

export interface MonthlyStatEntry {
  month: number;
  month_name: string;
  mean_return: number;
  median_return: number;
  std_return: number;
  positive_pct: number;
  count: number;
  best_year:  { year: number; return: number } | null;
  worst_year: { year: number; return: number } | null;
}

export interface DayOfWeekEntry {
  day: number;
  day_name: string;
  mean_return: number;
  std_return: number;
  positive_pct: number;
  count: number;
}

export interface WeeklyPatternEntry {
  week: number;
  mean_return: number;
  std: number;
  count: number;
}

export interface SeasonalityResult {
  decomposition: {
    dates:    string[];
    observed: (number | null)[];
    trend:    (number | null)[];
    seasonal: (number | null)[];
    residual: (number | null)[];
  };
  seasonal_strength: number;
  seasonal_strength_label: string;
  monthly_stats: MonthlyStatEntry[];
  monthly_matrix: {
    years:  number[];
    months: string[];
    values: (number | null)[][];
  };
  day_of_week: DayOfWeekEntry[];
  weekly_pattern: WeeklyPatternEntry[];
  dataset_name: string;
  period_analyzed: string;
  total_years: number;
}

export interface SMCResult {
  candles: SMCCandle[];
  swing_points: SwingPoint[];
  structure: StructurePoint[];
  breaks: StructureBreak[];
  zones: SDZone[];
  liquidity_pools: LiquidityPool[];
  summary: SMCSummary;
  interval?: string;
}

export interface CorrelationRequest {
  datasets: Array<{ name: string; dates: string[]; values: number[] }>;
  method?: "pearson" | "spearman";
  use_returns?: boolean;
  period?: "full" | "1y" | "2y" | "3y" | "ytd";
}

export interface CorrelationPair {
  pair: string;
  asset_a: string;
  asset_b: string;
  correlation: number;
  p_value: number;
  significant: boolean;
}

export interface CorrelationResult {
  correlation_matrix: { columns: string[]; values: number[][] };
  p_value_matrix: { columns: string[]; values: number[][] };
  method: string;
  used_returns: boolean;
  num_observations: number;
  period_start: string;
  period_end: string;
  top_correlations: CorrelationPair[];
  bottom_correlations: CorrelationPair[];
  pca_summary: {
    eigenvalues: number[];
    explained_variance_pct: number[];
    first_component_explains: number;
    interpretation: string;
  };
}

export interface RollingCorrelationRequest {
  asset_a: { name: string; dates: string[]; values: number[] };
  asset_b: { name: string; dates: string[]; values: number[] };
  window_sizes?: number[];
  use_returns?: boolean;
}

export interface RollingCorrelationPoint {
  date: string;
  correlation: number;
}

export interface RollingCorrelationResult {
  asset_a_name: string;
  asset_b_name: string;
  rolling_data: Record<string, RollingCorrelationPoint[]>;
  historical_stats: {
    mean: number;
    std: number;
    min: number;
    max: number;
    current: number;
    percentile_current: number;
  };
  regimes: Array<{
    start: string;
    end: string;
    avg_correlation: number;
    regime: "high" | "medium" | "low";
  }>;
}

export interface GrangerRequest {
  datasets: Array<{ name: string; dates: string[]; values: number[] }>;
  max_lag?: number;
  significance?: number;
}

export interface GrangerPairResult {
  cause: string;
  effect: string;
  best_lag: number;
  f_statistic: number;
  p_value: number;
  significant: boolean;
  direction: string;
  error?: string;
}

export interface GrangerResult {
  results: GrangerPairResult[];
  significant_pairs: GrangerPairResult[];
  network: {
    nodes: string[];
    edges: Array<{ from: string; to: string; lag: number; strength: number }>;
  };
  max_lag_tested: number;
  significance_level: number;
}

export interface RegimeScatterRequest {
  asset_a: { name: string; dates: string[]; values: number[] };
  asset_b: { name: string; dates: string[]; values: number[] };
  regime_window?: number;
  num_regimes?: number;
}

export interface RegimeScatterPoint {
  x: number;
  y: number;
  date: string;
  regime: "Low" | "Medium" | "High";
}

export interface RegimeStats {
  correlation: number;
  p_value: number;
  num_observations: number;
  pct_of_total: number;
}

export interface RegimeRegression {
  slope: number;
  intercept: number;
  r_squared: number;
}

export interface RegimeScatterResult {
  scatter_data: RegimeScatterPoint[];
  regime_correlations: Record<string, RegimeStats>;
  regime_regressions: Record<string, RegimeRegression>;
  regime_thresholds: { low_vol: number; high_vol: number };
  asset_a_name: string;
  asset_b_name: string;
}

export interface CrossLagRequest {
  asset_a: { name: string; dates: string[]; values: number[] };
  asset_b: { name: string; dates: string[]; values: number[] };
  max_lag?: number;
}

export interface CrossLagPoint {
  lag: number;
  correlation: number;
}

export interface CrossLagResult {
  cross_correlations: CrossLagPoint[];
  optimal_lag: { lag: number; correlation: number; interpretation: string };
  asset_a_name: string;
  asset_b_name: string;
}

export interface AlertPeriod {
  start: string;
  end: string;
  direction: "spike" | "breakdown";
  peak_z_score: number;
  avg_correlation_during: number;
  normal_correlation: number;
}

export interface PairAlertData {
  pair: string;
  asset_a: string;
  asset_b: string;
  normal_correlation: number;
  alerts: AlertPeriod[];
  current_z_score: number;
  current_status: "normal" | "alert";
}

export interface CorrelationAlertRequest {
  datasets: Array<{ name: string; dates: string[]; values: number[] }>;
  window?: number;
  z_threshold?: number;
  use_returns?: boolean;
}

export interface CorrelationAlertResult {
  pair_alerts: PairAlertData[];
  active_alerts: PairAlertData[];
  total_alert_count: number;
  most_unstable_pair: PairAlertData | null;
  currently_anomalous: PairAlertData[];
}
