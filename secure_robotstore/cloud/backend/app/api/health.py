"""Health.

`/health` is the container healthcheck's target and stays cheap — it must
not hit the database, or a slow query turns into a restarted container.

`/health/detail` is the one to open when something is wrong: it reports
each dependency separately, so "no data in the UI" resolves to a specific
broken leg (broker down / Redis empty / Postgres unreachable) instead of a
guess.

INTERN TASK (security): `/health/detail` leaks internal topology to anyone
who asks — connection states, row counts, subscriber counts. Decide what a
health endpoint should expose publicly and put the rest behind auth.
"""
import logging

from fastapi import APIRouter, Request

from app.db import postgres
from app.mqtt.topics import INT_KIND, STRING_KIND

router = APIRouter(tags=["health"])
logger = logging.getLogger("backend.api.health")


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/health/detail")
async def health_detail(request: Request) -> dict:
    state = request.app.state

    redis_ok = False
    try:
        redis_ok = await state.redis_client.ping()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"redis ping failed: {exc}")

    pg_ok = False
    row_counts: dict = {}
    try:
        row_counts = await postgres.counts(state.pg_pool)
        pg_ok = True
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"postgres check failed: {exc}")

    return {
        "status": "ok",
        "mqtt": {"connected": state.mqtt_service.connected},
        "redis": {"connected": bool(redis_ok)},
        "postgres": {"connected": pg_ok, **row_counts},
        "websocket_subscribers": state.hub.subscriber_count(),
        "kinds": [STRING_KIND, INT_KIND],
    }
