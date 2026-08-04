"""SessionManager - exclusive per-robot control sessions.

Exactly one operator may hold control of a given robot at a time (two
people fighting over the same joystick is worse than one person locked
out) - enforced with Redis's atomic `SET ... NX EX` (set-if-absent, with
expiry), the same primitive a distributed lock is built from. Postgres
gets a parallel, append-only audit row per session (who drove which robot,
when) - that's a durability need Redis, with its TTL-driven eviction, is
the wrong tool for.

The TTL is deliberately this module's version of the robot's own MQTT
Last-Will-and-Testament (see docs/03-mqtt-layer.md): a clean release
(operator clicks "release" or closes the teleop connection tidily) drops
the lock immediately; an unclean one (browser crash, network drop) is
bounded by the TTL instead of stranding the robot locked forever. Callers
must call renew() on every real activity (a control command, a WS
keepalive) to keep the lock alive during a normal session - see
fleet/manager.py and ws/teleop.py.

Known simplification, stated rather than hidden: release()/renew() are a
GET-then-conditional-write, not a single atomic Lua script, so there's a
narrow theoretical race between two calls for the same key. Acceptable for
this project's single-operator-per-robot, low-contention scope; a
production system under real contention would use a Lua script (or a
token-based Redlock-style release) to close that window.
"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import asyncpg
import redis.asyncio as redis

from app.models import SessionInfo


class SessionConflictError(Exception):
    """Raised when an operation can't proceed because a DIFFERENT operator
    already holds (or doesn't hold) the session in question."""


def _key(robot_id: str) -> str:
    return f"session:{robot_id}"


class SessionManager:
    def __init__(
        self,
        pg_pool: asyncpg.Pool,
        redis_client: redis.Redis,
        ttl_seconds: int,
        logger: Optional[logging.Logger] = None,
    ):
        self._pg = pg_pool
        self._redis = redis_client
        self._ttl_seconds = ttl_seconds
        self._logger = logger or logging.getLogger("backend.sessions")

    async def acquire(self, robot_id: str, operator: str) -> SessionInfo:
        existing = await self._read(robot_id)
        if existing is not None and existing["operator"] != operator:
            raise SessionConflictError(f"{robot_id} is already controlled by another operator")

        session_id = existing["session_id"] if existing else str(uuid.uuid4())
        acquired_at = existing["acquired_at"] if existing else time.time()
        value = {"session_id": session_id, "operator": operator, "acquired_at": acquired_at}
        await self._redis.set(_key(robot_id), json.dumps(value), ex=self._ttl_seconds)

        if existing is None:
            async with self._pg.acquire() as conn:
                await conn.execute(
                    "INSERT INTO control_sessions (session_id, robot_id, operator) VALUES ($1, $2, $3)",
                    uuid.UUID(session_id), robot_id, operator,
                )
            self._logger.info(f"{operator} acquired control of {robot_id}")

        return await self._to_info(robot_id, value)

    async def renew(self, robot_id: str, operator: str) -> None:
        current = await self._read(robot_id)
        if current is None or current["operator"] != operator:
            raise SessionConflictError(f"{operator} does not hold the active session for {robot_id}")
        await self._redis.expire(_key(robot_id), self._ttl_seconds)

    async def release(self, robot_id: str, operator: str) -> None:
        current = await self._read(robot_id)
        if current is None:
            return  # already gone - releasing twice is harmless
        if current["operator"] != operator:
            raise SessionConflictError(f"{operator} does not hold the active session for {robot_id}")
        await self._redis.delete(_key(robot_id))
        async with self._pg.acquire() as conn:
            await conn.execute(
                "UPDATE control_sessions SET ended_at = now() WHERE session_id = $1",
                uuid.UUID(current["session_id"]),
            )
        self._logger.info(f"{operator} released control of {robot_id}")

    async def get_holder(self, robot_id: str) -> Optional[str]:
        current = await self._read(robot_id)
        return current["operator"] if current else None

    async def require_holder(self, robot_id: str, operator: str) -> None:
        """Raises unless `operator` currently holds the session for
        `robot_id` - the check fleet/manager.py runs before forwarding any
        non-emergency control command."""
        current = await self._read(robot_id)
        if current is None or current["operator"] != operator:
            raise SessionConflictError(f"{operator} does not hold an active control session for {robot_id}")

    async def _read(self, robot_id: str) -> Optional[dict]:
        raw = await self._redis.get(_key(robot_id))
        return json.loads(raw) if raw else None

    async def _to_info(self, robot_id: str, value: dict) -> SessionInfo:
        # expires_at is derived from Redis's own remaining TTL, not
        # acquired_at + ttl_seconds - a renewed session's real expiry keeps
        # moving forward with every renew() call, and TTL is the only place
        # that's actually tracked.
        ttl_remaining = await self._redis.ttl(_key(robot_id))
        now = time.time()
        expires_at = datetime.fromtimestamp(now + max(ttl_remaining, 0), tz=timezone.utc)
        return SessionInfo(
            session_id=value["session_id"],
            robot_id=robot_id,
            operator=value["operator"],
            acquired_at=datetime.fromtimestamp(value["acquired_at"], tz=timezone.utc),
            expires_at=expires_at,
        )
