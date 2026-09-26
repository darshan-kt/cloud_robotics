"""Redis client + the live-state helpers.

The ephemeral half of the storage split. Everything here is either the
latest value (recomputable from the next MQTT message, one second away) or
a short ring buffer used to backfill a WebSocket client that just
connected. None of it needs to survive a Redis restart — which is exactly
the test the real system applies (cloud-container/backend/app/db/redis.py).

Why a Redis ring buffer when Postgres already has the full history: a
browser that connects mid-stream wants the last ~50 readings *now*, on a
path that runs on every connect. Serving that from Redis keeps a UI concern
off the durable store.

INTERN TASK (security): no password, and the container binds with
`--protected-mode no`. See docker-compose.yml.
"""
import json
import logging

import redis.asyncio as redis

logger = logging.getLogger("backend.db.redis")


def create_client(host: str, port: int) -> redis.Redis:
    client = redis.Redis(host=host, port=port, decode_responses=True)
    logger.info(f"redis client created ({host}:{port})")
    return client


def _latest_key(kind: str) -> str:
    return f"latest:{kind}"


def _history_key(kind: str) -> str:
    return f"history:{kind}"


async def set_latest(client: redis.Redis, kind: str, reading: dict, history_size: int) -> None:
    """Record a reading as both 'the current value' and 'recently seen'.

    Pipelined so the two writes go in one round trip — at one message per
    second per kind it hardly matters, but the habit is what keeps this
    shape workable when the rate goes up.
    """
    payload = json.dumps(reading)
    async with client.pipeline(transaction=False) as pipe:
        pipe.set(_latest_key(kind), payload)
        pipe.lpush(_history_key(kind), payload)
        # LTRIM is what makes this a ring buffer rather than an unbounded
        # list that eats memory until the container dies.
        pipe.ltrim(_history_key(kind), 0, history_size - 1)
        await pipe.execute()


async def get_latest(client: redis.Redis, kind: str) -> dict | None:
    raw = await client.get(_latest_key(kind))
    return json.loads(raw) if raw else None


async def get_history(client: redis.Redis, kind: str, limit: int) -> list[dict]:
    """Newest-first, matching how the UI renders it."""
    raw = await client.lrange(_history_key(kind), 0, limit - 1)
    return [json.loads(item) for item in raw]
