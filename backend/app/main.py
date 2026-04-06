from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health, data, market_data, analytics, scenario, seasonality, chat, correlation, signals, backtest

app = FastAPI(
    title="CommodityIQ API",
    version=settings.API_VERSION,
    description="Backend ML microservice for the CommodityIQ trading analytics platform.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(health.router)
app.include_router(data.router, prefix="/api/data")
app.include_router(market_data.router, prefix="/api/market")
app.include_router(analytics.router, prefix="/api/analytics")
app.include_router(scenario.router, prefix="/api/analytics")
app.include_router(seasonality.router, prefix="/api/analytics", tags=["seasonality"])
app.include_router(correlation.router, prefix="/api/analytics", tags=["correlation"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(signals.router,   prefix="/api", tags=["signals"])
app.include_router(backtest.router,  prefix="/api", tags=["backtest"])


@app.get("/")
def root():
    return {"message": "CommodityIQ API", "version": "0.1.0", "docs": "/docs"}
