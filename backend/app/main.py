from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health, data, market_data, analytics, scenario

app = FastAPI(
    title="CommodityIQ API",
    version=settings.API_VERSION,
    description="Backend ML microservice for the CommodityIQ trading analytics platform.",
)

origins = list({
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://localhost:3001",
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(data.router, prefix="/api/data")
app.include_router(market_data.router, prefix="/api/market")
app.include_router(analytics.router, prefix="/api/analytics")
app.include_router(scenario.router, prefix="/api/analytics")


@app.get("/")
def root():
    return {"message": "CommodityIQ API", "version": "0.1.0", "docs": "/docs"}
