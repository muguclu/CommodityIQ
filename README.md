# CommodityIQ

Professional commodity trading analytics platform. Bloomberg Terminal meets modern web design.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11, pydantic-settings |
| Data | pandas, numpy, yfinance |
| Fonts | Geist Sans + Geist Mono |

## Project Structure

```
commodityiq/
├── frontend/          # Next.js 14 App Router
└── backend/           # FastAPI Python service
```

## Getting Started

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Runs at: http://localhost:3000

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

API runs at: http://localhost:8000  
Swagger docs: http://localhost:8000/docs

## Modules

| Module | Route | Phase | Status |
|--------|-------|-------|--------|
| Dashboard | `/` | — | ✅ Active |
| Data Hub | `/data` | 1 | 🔜 Coming Soon |
| Regression | `/regression` | 1 | 🔜 Coming Soon |
| Forecast | `/forecast` | 2 | 🔜 Coming Soon |
| Scenario | `/scenario` | 2 | 🔜 Coming Soon |
| Seasonality | `/seasonality` | 2 | 🔜 Coming Soon |
| Correlation | `/correlation` | 3 | 🔜 Coming Soon |
| AI Chat | `/chat` | 3 | 🔜 Coming Soon |

## Environment Variables

**Frontend** (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Backend** (`backend/.env`):
```
DEBUG=false
CORS_ORIGINS=["http://localhost:3000"]
```
