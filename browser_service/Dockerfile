FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir playwright==1.58.0 && \
    playwright install --with-deps chromium && \
    playwright install chromium

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]