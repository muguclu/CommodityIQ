# CommodityIQ

> Professional commodity trading analytics platform — Bloomberg Terminal meets modern web design.

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

## Hybrid TFT Pipeline

```
Raw Price Data
      │
      ▼
Wavelet Decomposition (db4, level 3)
      ├── Trend (low-frequency)  ──► TFT Training & Forecast
      └── Noise (high-frequency) ──► GARCH Volatility Estimation
                                           │
                                           ▼
                               Hybrid Forecast = TFT Trend ± GARCH CI
```

**Notes:**
- Minimum 200 data points required for TFT
- Chunk sizes adapt automatically to dataset length
- Falls back to linear extrapolation if TFT training fails
- Frontend timeout set to 3 minutes to accommodate CPU training

---

## Module Status

| Module | Route | Status |
|--------|-------|--------|
| Dashboard | `/` | ✅ Active |
| Data Hub | `/data` | ✅ Active |
| Regression | `/regression` | ✅ Active |
| Forecast | `/forecast` | ✅ Active |
| Scenario | `/scenario` | ✅ Active |
| Seasonality | `/seasonality` | 🔜 Coming Soon |
| Correlation | `/correlation` | 🔜 Coming Soon |
| AI Chat | `/chat` | 🔜 Coming Soon |

---

## License

MIT
