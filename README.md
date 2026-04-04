# CommodityIQ



CommodityIQ brings institutional-grade forecasting and signal analysis to any commodity or equity ticker. It combines classical statistical models with deep learning (Temporal Fusion Transformer) and volatility modelling (GARCH) behind a clean, dark-themed dashboard.

---

## Features

### Forecast Engine
- **Auto-ARIMA** — automatic order selection with AIC/BIC
- **ETS (Exponential Smoothing)** — Holt-Winters additive/multiplicative
- **Linear Trend** — ordinary least-squares baseline
- **Hybrid TFT** — full deep learning pipeline:
  - Wavelet denoising (PyWavelets) → separates trend from noise
  - Temporal Fusion Transformer (Darts + PyTorch Lightning) → trained on denoised trend
  - GARCH(1,1) volatility modelling (arch) → scales confidence bands dynamically
  - Adaptive chunk sizing so training works on short datasets

### Signal Decomposition View
Collapsible panel shown with Hybrid TFT results:
- Original vs Denoised Price overlay chart
- Noise component bar chart (colour-coded by ±2σ thresholds)
- GARCH conditional volatility timeline with P25/P75 regime zones
- Summary banner: noise variance %, SNR (dB), volatility trend, CI band type

### Signal Health Panel
Real-time diagnostics from the hybrid pipeline: wavelet SNR, GARCH persistence, regime classification, TFT training status.

### Model Comparison Table
Side-by-side metrics (MAPE, RMSE, MAE, R²) for all selected models with ranking medals and deep-learning badges.

### Scenario Analysis
Shock simulation, sensitivity sweeps, and historical event replay.

### Data Hub
CSV upload + live market data fetch via yfinance for any ticker/commodity symbol.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Charts | Recharts (ComposedChart, LineChart, BarChart, AreaChart) |
| Icons | Lucide React |
| Backend | FastAPI 0.111, Python 3.11, Pydantic v2 |
| Deep Learning | Darts 0.30, PyTorch, PyTorch Lightning 2.4 |
| Wavelet | PyWavelets 1.4 |
| Volatility | arch 8.0 (GARCH) |
| Statistical | statsmodels, pmdarima, scipy |
| Market Data | yfinance |
| Fonts | Geist Sans + Geist Mono |

---

## Project Structure

```
CommodityIQ/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── forecast/page.tsx       # Forecast page (main UI)
│   │   │   ├── data/page.tsx           # Data Hub
│   │   │   ├── regression/page.tsx     # Regression analysis
│   │   │   ├── scenario/page.tsx       # Scenario analysis
│   │   │   ├── seasonality/page.tsx    # Seasonality decomposition
│   │   │   └── correlation/page.tsx    # Correlation matrix
│   │   ├── components/layout/          # Sidebar, Header
│   │   └── lib/
│   │       ├── api.ts                  # Axios client (180s timeout for TFT)
│   │       └── types.ts                # TypeScript interfaces
│   └── package.json
│
└── backend/
    ├── app/
    │   ├── routers/
    │   │   ├── analytics.py            # /api/analytics/* (forecast, regression)
    │   │   ├── scenario.py             # /api/analytics/scenario/*
    │   │   ├── market_data.py          # /api/market/*
    │   │   └── data.py                 # /api/data/upload-csv
    │   ├── services/
    │   │   ├── hybrid_forecast.py      # Orchestrates full TFT pipeline
    │   │   ├── tft_engine.py           # TFT train + forecast (Darts)
    │   │   ├── wavelet_service.py      # Wavelet decomposition
    │   │   └── garch_engine.py         # GARCH volatility modelling
    │   └── models/schemas.py           # Pydantic request/response schemas
    └── requirements.txt
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11
- (Optional) GPU — TFT trains on CPU by default (~60–120 s per run)

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

API: http://localhost:8000  
Swagger UI: http://localhost:8000/docs

---

## Environment Variables

**`frontend/.env.local`**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**`backend/.env`**
```
FRONTEND_URL=http://localhost:3000
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/analytics/forecast` | Run forecast (ARIMA / ETS / Linear / Hybrid TFT) |
| `POST` | `/api/analytics/regression` | OLS regression |
| `POST` | `/api/analytics/regression/stepwise` | Stepwise regression |
| `POST` | `/api/analytics/regression/rolling` | Rolling regression |
| `POST` | `/api/analytics/scenario` | Scenario shock simulation |
| `POST` | `/api/analytics/scenario/compare` | Multi-scenario comparison |
| `POST` | `/api/analytics/scenario/sensitivity` | Sensitivity sweep |
| `POST` | `/api/analytics/scenario/risk-metrics` | VaR / CVaR / Sharpe |
| `GET` | `/api/analytics/scenario/historical-events` | Preset historical shocks |
| `POST` | `/api/market/fetch` | Fetch market data via yfinance |
| `GET` | `/api/market/commodities` | List available commodity symbols |
| `POST` | `/api/data/upload-csv` | Upload CSV dataset |

---

## Hybrid TFT — Full Methodology

The Hybrid TFT model is the core differentiator of CommodityIQ. It combines three distinct disciplines — wavelet signal processing, deep learning sequence modelling, and econometric volatility modelling — into a single end-to-end pipeline. The key insight is that financial price series are a superposition of a **low-frequency trend** (predictable structure) and a **high-frequency noise** (volatility clustering). By separating these two components and modelling each with the optimal tool, the forecast quality and confidence interval realism both improve substantially over a single-model approach.

---

### Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     RAW COMMODITY PRICE SERIES                      │
 │                  P₁, P₂, P₃, …, Pₙ  (close prices)                 │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │            STAGE 1 — DISCRETE WAVELET TRANSFORM (DWT)              │
 │                   Daubechies-4 (db4), Level 2                       │
 │                                                                     │
 │  wavedec(P, 'db4', level=2)  →  [cA₂ | cD₂ | cD₁]                 │
 │                                   ↓         ↓                       │
 │              Low-freq (Trend)    High-freq (Noise)                  │
 │               T = IDWT(cA₂)      N = P − T                         │
 └──────────────┬────────────────────────────┬────────────────────────┘
                │                            │
                ▼                            ▼
 ┌──────────────────────────┐  ┌─────────────────────────────────────┐
 │  STAGE 2 — TFT FORECAST  │  │    STAGE 3 — GARCH(1,1) on NOISE   │
 │  (Darts + PyTorch)        │  │    (arch library)                   │
 │                          │  │                                     │
 │  Input: ΔT (differenced) │  │  σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁     │
 │  Past covariates:        │  │                                     │
 │    MA5, MA20, Volatility │  │  Output: σ̂ₜ₊₁ … σ̂ₜ₊ₕ             │
 │    Momentum              │  │  (conditional std per horizon step) │
 │  Future covariates:      │  │                                     │
 │    Month, DayOfWeek,     │  └───────────────────┬─────────────────┘
 │    Quarter               │                      │
 │                          │                      │
 │  Forecast: T̂ₜ₊₁ … T̂ₜ₊ₕ │                      │
 └──────────────┬───────────┘                      │
                │                                  │
                └──────────────┬───────────────────┘
                               ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │             STAGE 4 — RECONSTRUCTION + DYNAMIC CI BANDS            │
 │                                                                     │
 │   F̂ₜ₊ₖ  =  T̂ₜ₊ₖ  +  μ̂ₙₒᵢₛₑ,ₖ                                    │
 │                                                                     │
 │   CI⁺ₖ  =  F̂ₜ₊ₖ  +  z(α) · σ̂ₖ        ← GARCH-scaled             │
 │   CI⁻ₖ  =  F̂ₜ₊ₖ  −  z(α) · σ̂ₖ        ← widens in crises         │
 │                                                                     │
 │   z(0.95) = 1.96  |  z(0.99) = 2.576                               │
 └─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │             STAGE 5 — BACKTEST (walk-forward on test set)          │
 │   Metrics: MAPE, RMSE, MAE, Theil's U                              │
 └─────────────────────────────────────────────────────────────────────┘
```

---

### Stage 1 — Wavelet Decomposition

**Algorithm:** Discrete Wavelet Transform (DWT) with Daubechies-4 (`db4`) mother wavelet, decomposition level 2.

**Why db4?** Daubechies-4 has 4 vanishing moments and compact support — it captures smooth, finance-relevant trends without the ringing artefacts of higher-order wavelets. Level 2 produces two detail layers (`cD1`, `cD2`) and one approximation (`cA2`):

```
Level 0:  P  (original, length n)
           │
Level 1:  cA1 (smooth)  +  cD1 (fine detail, ~1–2 day cycles)
           │
Level 2:  cA2 (trend)   +  cD2 (medium detail, ~3–7 day cycles)
```

- **Trend reconstruction:** Zero out all detail coefficients, apply IDWT → `T`
- **Noise extraction:** `N = P − T`

**Look-ahead bias prevention:** For the test set, decomposition is applied as a **sliding window** (default 252 bars). At each time step `t`, DWT is applied only to `P[t−252 : t]` and only the last value is retained — no future data leaks into any historical point.

| Parameter | Value | Notes |
|-----------|-------|-------|
| Wavelet | `db4` | Optimal for financial price series |
| Level | 2 | Smoother trend vs. level 1; less lag vs. level 3+ |
| Online window | 252 bars | ~1 trading year lookback for test decomposition |
| Minimum length | 8 points | `2^(level+1)` — enforced at runtime |

---

### Stage 2 — Temporal Fusion Transformer (TFT)

The TFT is trained exclusively on the **differenced low-frequency trend** (ΔT), which makes the series stationary and causes the model to learn daily *changes* rather than absolute price levels. Absolute levels are recovered at inference time via cumulative summation from the last known trend value.

**Model architecture (CPU-optimised defaults):**

| Hyperparameter | Value | Description |
|---------------|-------|-------------|
| `hidden_size` | 32 | Encoder/decoder width (production: 64–128) |
| `lstm_layers` | 1 | Number of LSTM encoder layers |
| `num_attention_heads` | 2 | Multi-head self-attention heads |
| `dropout` | 0.1 | Applied to all sub-layers |
| `input_chunk_length` | 60 | Lookback window fed to the model |
| `output_chunk_length` | 30 | Bars predicted per forward pass |
| `max_epochs` | 30 | CPU training (production: 100+) |
| `learning_rate` | 1e-3 | Adam optimiser |
| `batch_size` | 32 | Reduced if dataset is short |

**Input features:**

```
Past covariates (known up to t):
  ├── MA5    — 5-bar moving average of ΔT
  ├── MA20   — 20-bar moving average of ΔT
  ├── Vol20  — 20-bar rolling std of ΔT
  └── Mom10  — 10-bar cumulative sum of ΔT (momentum proxy)

Future covariates (calendar, known for all t):
  ├── Month        (1–12)
  ├── DayOfWeek    (0–4, Mon–Fri)
  └── Quarter      (1–4)
```

**Adaptive chunk sizing:** If the dataset is shorter than the default `input_chunk + output_chunk + 1`, the engine automatically reduces `output_chunk` (by 5) and then `input_chunk` (by 10) until both the training and validation splits are at least `input_chunk + output_chunk + 1` bars long. This ensures the model trains even on sub-500-bar datasets.

**Forecasting beyond one chunk:** When the requested horizon exceeds `output_chunk_length`, the model iterates in auto-regressive steps — appending each prediction back into the series before producing the next `output_chunk` block.

**Fallback:** If Darts/PyTorch is unavailable or training fails, a simple OLS linear extrapolation of the last 60 trend values is substituted. This is flagged as `tft_fallback: linear_extrapolation` in the signal health panel.

---

### Stage 3 — GARCH(1,1) Volatility Modelling

GARCH is fitted to the **noise component** `N` from the wavelet decomposition. Because `N` represents the high-frequency residual of the price series, it exhibits the defining feature of financial noise: **volatility clustering** — large moves tend to cluster together (ARCH effects).

**Model specification:**

```
Noise residual equation:   Nₜ = σₜ · εₜ,   εₜ ~ N(0,1)

Variance equation:         σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁

Persistence:               α + β   (close to 1 = long memory)
```

- **ω (omega):** Baseline unconditional variance floor
- **α (alpha / ARCH term):** How much yesterday's shock affects today's variance
- **β (beta / GARCH term):** How much yesterday's variance carries over
- **Persistence (α + β):** Values near 1.0 indicate volatility shocks are long-lasting

The noise is scaled to percentage-returns magnitude (`× 100 / std`) before GARCH fitting for numerical stability, then rescaled back for CI construction.

**Volatility regime classification** (shown in Signal Health panel):

| Regime | Condition |
|--------|-----------|
| `low` | Current σ < 25th percentile of historical σ |
| `normal` | 25th ≤ current σ ≤ 75th percentile |
| `high` | Current σ > 75th percentile of historical σ |

---

### Stage 4 — Reconstruction & Dynamic Confidence Bands

```
Final forecast:   F̂ₜ₊ₖ = T̂ₜ₊ₖ + μ̂_noise,k

Upper CI:         F̂ₜ₊ₖ + z(α/2) · σ̂_GARCH,k
Lower CI:         F̂ₜ₊ₖ − z(α/2) · σ̂_GARCH,k
```

The critical difference from classical models: **the CI width is not constant**. It expands when GARCH forecasts rising volatility (e.g., after a shock) and contracts during calm regimes. This makes the uncertainty bands behave like real market risk rather than symmetric ±N% tubes.

If GARCH fitting fails (insufficient data or convergence error), the CI falls back to `±z · std(N_train)` — static historical noise spread.

**CI type** is reported in the Signal Health panel as either `dynamic_garch` or `static_historical`.

---

### Stage 5 — Backtest

A walk-forward backtest is performed on the held-out test set (default 20% of data). The backtest uses the **online-decomposed trend** on the full series — meaning the TFT is never evaluated on data it was trained on. Metrics:

| Metric | Formula |
|--------|---------|
| MAPE | `mean(|actual − predicted| / actual) × 100` |
| RMSE | `sqrt(mean((actual − predicted)²))` |
| MAE | `mean(|actual − predicted|)` |
| Theil's U | `RMSE_model / RMSE_naïve` — values < 1 beat random walk |

---

### Signal Health Panel

The Signal Health panel surfaces live diagnostics from the pipeline run:

| Field | Meaning | Good range |
|-------|---------|------------|
| `snr_db` | Signal-to-noise ratio of wavelet decomposition (dB) | > 10 dB |
| `noise_normality` | Shapiro-Wilk p-value > 0.05 → GARCH assumption holds | `normal` |
| `garch_persistence` | α + β from fitted GARCH | 0.85–0.98 typical |
| `volatility_regime` | Current σ vs. historical percentiles | `low / normal / high` |
| `tft_available` | Darts + PyTorch installed | `true` |
| `tft_trained` | TFT training converged | `true` |
| `ci_type` | Source of confidence band width | `dynamic_garch` preferred |

---

### Requirements & Limits

| Constraint | Value |
|-----------|-------|
| Minimum data points (TFT) | 200 bars |
| Minimum data points (GARCH) | 50 bars |
| Minimum data points (DWT level 2) | 8 bars |
| Typical CPU training time | 60–120 seconds |
| Frontend timeout | 180 seconds |
| Default train/test split | 80 / 20 % |
| Default confidence level | 95% |

---

## Module Status

| Module | Route | Status |
|--------|-------|--------|
| Dashboard | `/` | ✅ Active |
| Data Hub | `/data` | ✅ Active |
| Regression | `/regression` | ✅ Active |
| Forecast | `/forecast` | ✅ Active |
| Scenario | `/scenario` | ✅ Active |
| Seasonality | `/seasonality` | ✅ Active |
| Correlation | `/correlation` | ✅ Active |
| AI Chat | `/chat` | ✅ Active |

---

