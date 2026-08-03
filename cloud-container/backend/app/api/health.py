"""Health and metrics endpoints.

GET /health backs the container's own HEALTHCHECK and the frontend's
connection indicator. GET /metrics is a stub - real fleet/session metrics
arrive in Milestone 7.
"""
from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "cloud-robotics-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/metrics")
def metrics() -> dict:
    return {
        "note": "placeholder - real metrics arrive in Milestone 7",
    }
