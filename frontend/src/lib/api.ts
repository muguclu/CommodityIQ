import axios from "axios";
import type { ChatRequest, ChatResponse, CommodityDataset, CommodityInfo, CorrelationAlertRequest, CorrelationAlertResult, CorrelationRequest, CorrelationResult, CrossLagRequest, CrossLagResult, FetchMarketRequest, FetchMarketResponse, ForecastRequest, ForecastResult, GrangerRequest, GrangerResult, HistoricalEvent, RegressionRequest, RegressionResult, RegimeScatterRequest, RegimeScatterResult, ReplayRequest, ReplayResult, RiskMetricsRequest, RiskMetricsResult, RollingCorrelationRequest, RollingCorrelationResult, RollingRegressionRequest, RollingRegressionResult, ScenarioCompareRequest, ScenarioCompareResult, ScenarioRequest, ScenarioResult, SeasonalityRequest, SeasonalityResult, SeasonalSignalRequest, SeasonalSignalResult, SensitivityRequest, SensitivityResult, SMCRequest, SMCResult, StepwiseRequest, StepwiseResult, StructuralBreakRequest, StructuralBreakResult, YoYRequest, YoYResult } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 180000,  // 3 minutes — TFT training is CPU-intensive
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.detail ?? error.message ?? "An unexpected error occurred";
    return Promise.reject(new Error(message));
  }
);

export async function fetchAvailableCommodities(): Promise<CommodityInfo[]> {
  const { data } = await api.get<CommodityInfo[]>("/api/market/commodities");
  return data;
}

export async function fetchMarketData(req: FetchMarketRequest): Promise<FetchMarketResponse> {
  const { data } = await api.post<FetchMarketResponse>("/api/market/fetch", req);
  return data;
}

export async function uploadCSV(file: File): Promise<CommodityDataset> {
  const formData = new FormData();
  formData.append("file", file);
  const { data: res } = await api.post("/api/data/upload-csv", formData);
  if (!res.success || !res.data) throw new Error(res.error ?? "Upload failed");
  return res.data as CommodityDataset;
}

export async function runRegression(request: RegressionRequest): Promise<RegressionResult> {
  const { data } = await api.post<RegressionResult>("/api/analytics/regression", request);
  return data;
}

export async function runStepwise(request: StepwiseRequest): Promise<StepwiseResult> {
  const { data } = await api.post<StepwiseResult>("/api/analytics/regression/stepwise", request);
  return data;
}

export async function runForecast(request: ForecastRequest): Promise<ForecastResult> {
  const { data } = await api.post<ForecastResult>("/api/analytics/forecast", request, {
    timeout: 180000,  // 3 minutes for forecast (TFT can be slow on CPU)
  });
  return data;
}

export async function runRollingRegression(request: RollingRegressionRequest): Promise<RollingRegressionResult> {
  const { data } = await api.post<RollingRegressionResult>("/api/analytics/regression/rolling", request);
  return data;
}

export async function runStructuralBreaks(request: StructuralBreakRequest): Promise<StructuralBreakResult> {
  const { data } = await api.post<StructuralBreakResult>("/api/analytics/regression/structural-breaks", request);
  return data;
}

export async function runScenario(request: ScenarioRequest): Promise<ScenarioResult> {
  const { data } = await api.post<ScenarioResult>("/api/analytics/scenario", request);
  return data;
}

export async function compareScenarios(request: ScenarioCompareRequest): Promise<ScenarioCompareResult> {
  const { data } = await api.post<ScenarioCompareResult>("/api/analytics/scenario/compare", request);
  return data;
}

export async function runSensitivity(request: SensitivityRequest): Promise<SensitivityResult> {
  const { data } = await api.post<SensitivityResult>("/api/analytics/scenario/sensitivity", request);
  return data;
}

export async function getHistoricalEvents(): Promise<HistoricalEvent[]> {
  const { data } = await api.get<HistoricalEvent[]>("/api/analytics/scenario/historical-events");
  return data;
}

export async function replayEvent(request: ReplayRequest): Promise<ReplayResult> {
  const { data } = await api.post<ReplayResult>("/api/analytics/scenario/replay", request);
  return data;
}

export async function calculateRiskMetrics(request: RiskMetricsRequest): Promise<RiskMetricsResult> {
  const { data } = await api.post<RiskMetricsResult>("/api/analytics/scenario/risk-metrics", request);
  return data;
}

export async function analyzeSMC(request: SMCRequest): Promise<SMCResult> {
  const { data } = await api.post<SMCResult>("/api/analytics/smc", request);
  return data;
}

export async function runSeasonality(request: SeasonalityRequest): Promise<SeasonalityResult> {
  const { data } = await api.post<SeasonalityResult>("/api/analytics/seasonality", request);
  return data;
}

export async function runYoY(request: YoYRequest): Promise<YoYResult> {
  const { data } = await api.post<YoYResult>("/api/analytics/seasonality/yoy", request);
  return data;
}

export async function runSeasonalSignals(request: SeasonalSignalRequest): Promise<SeasonalSignalResult> {
  const { data } = await api.post<SeasonalSignalResult>("/api/analytics/seasonality/signals", request);
  return data;
}

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>("/api/chat", request);
  return data;
}

export async function explainResults(request: {
  analysis_type: string;
  results_summary: Record<string, unknown>;
  dataset_names: string[];
  user_context?: string;
}): Promise<{ explanation: string; analysis_type: string }> {
  const { data } = await api.post("/api/chat/explain", request);
  return data;
}

export async function runCorrelation(request: CorrelationRequest): Promise<CorrelationResult> {
  const { data } = await api.post<CorrelationResult>("/api/analytics/correlation", request);
  return data;
}

export async function runRollingCorrelation(request: RollingCorrelationRequest): Promise<RollingCorrelationResult> {
  const { data } = await api.post<RollingCorrelationResult>("/api/analytics/correlation/rolling", request);
  return data;
}

export async function runGrangerCausality(request: GrangerRequest): Promise<GrangerResult> {
  const { data } = await api.post<GrangerResult>("/api/analytics/correlation/granger", request);
  return data;
}

export async function runRegimeScatter(request: RegimeScatterRequest): Promise<RegimeScatterResult> {
  const { data } = await api.post<RegimeScatterResult>("/api/analytics/correlation/regime-scatter", request);
  return data;
}

export async function runCrossLag(request: CrossLagRequest): Promise<CrossLagResult> {
  const { data } = await api.post<CrossLagResult>("/api/analytics/correlation/cross-lag", request);
  return data;
}

export async function runCorrelationAlerts(request: CorrelationAlertRequest): Promise<CorrelationAlertResult> {
  const { data } = await api.post<CorrelationAlertResult>("/api/analytics/correlation/alerts", request);
  return data;
}
