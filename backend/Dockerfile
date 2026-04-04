FROM python:3.11-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU-only (küçük, hızlı)
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    torch==2.3.0+cpu

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Darts (TFT için)
RUN pip install --no-cache-dir "u8darts[torch]" || pip install --no-cache-dir darts || true

# App
COPY ./app ./app

# HF Spaces 7860 portunu kullanır
EXPOSE 7860

# HF Spaces için port 7860 olmalı
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", "--timeout-keep-alive", "300"]
