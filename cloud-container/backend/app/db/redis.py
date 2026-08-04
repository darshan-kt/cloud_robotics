"""Redis client factory.

Redis holds this backend's live, ephemeral state - the things that are
either expensive to recompute from Postgres on every read (a robot's
current online/offline status and latest telemetry/health snapshot,
refreshed on every MQTT message) or that need Redis's atomic
"SET-if-not-exists-with-expiry" primitive, which Postgres has no equivalent
of without hand-rolled advisory locking: the exclusive per-robot control
session lock (see sessions/manager.py). None of it needs to survive a
Redis restart - it's all either re-derived from the next MQTT message or
re-acquired by whichever operator asks first. See docs/07-cloud-backend.md.
"""
import logging
from typing import Optional

import redis.asyncio as redis


def create_client(host: str, port: int, logger: Optional[logging.Logger] = None) -> redis.Redis:
    logger = logger or logging.getLogger("backend.db.redis")
    client = redis.Redis(host=host, port=port, decode_responses=True)
    logger.info(f"Redis client created ({host}:{port})")
    return client
