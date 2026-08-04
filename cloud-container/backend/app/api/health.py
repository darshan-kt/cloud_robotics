"""Health and metrics endpoints.

GET /health backs the container's own HEALTHCHECK and the frontend's
connection indicator - unauthenticated on purpose, same reasoning as
robot_agent/health_server.py: an orchestrator polling this shouldn't need
credentials. GET /metrics now reports real fleet state (Milestone 7),
reading app.state the same way the robots/ router does - see main.py's
lifespan for where fleet_manager/mqtt_service are set.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    mqtt = getattr(request.app.state, "mqtt_service", None)
    mqtt_connected = bool(mqtt and mqtt.is_connected)
    return {
        "status": "ok" if mqtt_connected else "degraded",
        "service": "cloud-robotics-backend",
        "mqtt_connected": mqtt_connected,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/metrics")
async def metrics(request: Request) -> dict:
    fleet = getattr(request.app.state, "fleet_manager", None)
    mqtt = getattr(request.app.state, "mqtt_service", None)
    robots = await fleet.list_robots() if fleet else []
    return {
        "robots_known": len(robots),
        "robots_online": sum(1 for r in robots if r.status == "online"),
        "robots_in_use": sum(1 for r in robots if r.in_use_by is not None),
        "mqtt_connected": bool(mqtt and mqtt.is_connected),
    }
