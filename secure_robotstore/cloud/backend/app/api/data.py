"""REST reads over the two data kinds.

The WebSockets in ws/stream.py are how the UI stays live; these exist for
the things a socket is bad at — "give me the current value once" and "show
me what Postgres actually persisted". They are also the easiest way for an
intern to see the Redis/Postgres split with curl:

    curl localhost:8001/api/string/latest    # Redis  — the live value
    curl localhost:8001/api/string/history   # Postgres — the durable rows

INTERN TASK (security): every route here is unauthenticated, and `limit`
goes to the database with only a cap applied. Add the auth dependency and
proper query validation.
"""
import logging

from fastapi import APIRouter, Query, Request

from app.db import postgres, redis as redis_db
from app.mqtt.topics import INT_KIND, STRING_KIND

router = APIRouter(prefix="/api", tags=["data"])
logger = logging.getLogger("backend.api.data")

# A cap exists so an intern's first `?limit=100000000` doesn't take the
# database down. It is not a substitute for real validation.
_MAX_LIMIT = 200


@router.get("/{kind}/latest")
async def latest(kind: str, request: Request) -> dict:
    if kind not in (STRING_KIND, INT_KIND):
        return {"error": f"unknown kind {kind!r}"}
    reading = await redis_db.get_latest(request.app.state.redis_client, kind)
    return {"kind": kind, "source": "redis", "reading": reading}


@router.get("/{kind}/history")
async def history(
    kind: str,
    request: Request,
    limit: int = Query(default=50, ge=1, le=_MAX_LIMIT),
) -> dict:
    if kind not in (STRING_KIND, INT_KIND):
        return {"error": f"unknown kind {kind!r}"}

    pool = request.app.state.pg_pool
    if kind == STRING_KIND:
        rows = await postgres.recent_string_readings(pool, limit)
    else:
        rows = await postgres.recent_int_readings(pool, limit)
    return {"kind": kind, "source": "postgres", "readings": rows}
