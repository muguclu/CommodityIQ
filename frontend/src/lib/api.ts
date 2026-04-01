import axios from "axios";
import type { CommodityDataset, CommodityInfo, FetchMarketRequest, FetchMarketResponse, ForecastRequest, ForecastResult, HistoricalEvent, RegressionRequest, RegressionResult, ReplayRequest, ReplayResult, RiskMetricsRequest, RiskMetricsResult, RollingRegressionRequest, RollingRegressionResult, ScenarioCompareRequest, ScenarioCompareResult, ScenarioRequest, ScenarioResult, SensitivityRequest, SensitivityResult, SMCRequest, SMCResult, StepwiseRequest, StepwiseResult, StructuralBreakRequest, StructuralBreakResult } from "./types";

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
