# Build context: cloud-container/  (so this can COPY both backend/ and the
# sibling config/ folder - see docker-compose.yml's `backend` service).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# curl backs this image's own HEALTHCHECK below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY config ./config

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=10s \
    CMD curl -f http://localhost:8000/health || exit 1

# No --reload here: this is what actually ships. docker-compose.yml adds
# --reload as a dev-only command override.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
