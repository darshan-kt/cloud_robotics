"""RobotRegistry - what the backend knows about the fleet, split across the
two stores on purpose:

- **Postgres**: durable identity. Which robots exist at all and their
  display metadata - written once (first time a robot is ever seen) and
  read rarely (only when nothing's in the Redis cache yet). This is exactly
  the data that must NOT vanish if Redis is restarted or evicts a key.
- **Redis**: live state. Online/offline, last-seen timestamp, and the most
  recent telemetry/health payload - all of it refreshed on essentially
  every MQTT message and only ever needed "as of right now", never as
  history. Redis's speed matters here because GET /robots gets polled by
  every connected dashboard.

See docs/07-cloud-backend.md for the full reasoning and docs/03-mqtt-layer.md
for the payload shapes this reads (robot_agent's own `timestamp` fields are
Unix epoch floats via Python's `time.time()`, not ISO8601 - only `cmd`'s
`issued_at` uses ISO8601, see mqtt/service.py's publish_command).
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import asyncpg
import redis.asyncio as redis

from app.models import RobotSummary


def _key(robot_id: str, field: str) -> str:
    return f"robot:{robot_id}:{field}"


class RobotRegistry:
    def __init__(self, pg_pool: asyncpg.Pool, redis_client: redis.Redis, logger: Optional[logging.Logger] = None):
        self._pg = pg_pool
        self._redis = redis_client
        self._logger = logger or logging.getLogger("backend.registry")

    # --- writes, called from MQTT message handlers (see main.py wiring) ---
    async def record_status(self, robot_id: str, payload: dict) -> None:
        await self._ensure_registered(robot_id)
        status = payload.get("status", "unknown")
        await self._redis.set(_key(robot_id, "status"), status)
        await self._touch_last_seen(robot_id, payload.get("timestamp"))
        self._logger.info(f"{robot_id} status -> {status}")

    async def record_telemetry(self, robot_id: str, payload: dict) -> None:
        await self._redis.set(_key(robot_id, "telemetry"), json.dumps(payload))
        await self._touch_last_seen(robot_id, payload.get("timestamp"))

    async def record_health(self, robot_id: str, payload: dict) -> None:
        await self._redis.set(_key(robot_id, "health"), json.dumps(payload))
        await self._touch_last_seen(robot_id, payload.get("timestamp"))

    async def record_lidar_scan(self, robot_id: str, payload: dict) -> None:
        # Same shape as telemetry/health: latest-value-only, no history -
        # a dashboard polling GET /robots/{id} only ever wants "right now."
        await self._redis.set(_key(robot_id, "lidar"), json.dumps(payload))
        await self._touch_last_seen(robot_id, payload.get("timestamp"))

    async def record_heartbeat(self, robot_id: str, payload: dict) -> None:
        await self._touch_last_seen(robot_id, payload.get("timestamp"))

    async def _touch_last_seen(self, robot_id: str, timestamp: Optional[float]) -> None:
        await self._redis.set(_key(robot_id, "last_seen"), timestamp or _now_epoch())

    async def _ensure_registered(self, robot_id: str) -> None:
        """First-seen auto-registration: any robot that ever authenticates
        to the broker and reports status becomes a known fleet member -
        there's no separate provisioning workflow yet (see
        docs/07-cloud-backend.md for why that's the right scope for this
        milestone). Idempotent - safe to call on every status message, not
        just the first."""
        async with self._pg.acquire() as conn:
            await conn.execute(
                "INSERT INTO robots (robot_id, display_name) VALUES ($1, $1) "
                "ON CONFLICT (robot_id) DO NOTHING",
                robot_id,
            )

    # --- reads, called from the REST API (see api/robots.py) ---
    async def list_robots(self) -> list[RobotSummary]:
        async with self._pg.acquire() as conn:
            rows = await conn.fetch("SELECT robot_id, display_name FROM robots ORDER BY robot_id")
        return [await self._summarize(row["robot_id"], row["display_name"]) for row in rows]

    async def get_robot(self, robot_id: str) -> Optional[RobotSummary]:
        async with self._pg.acquire() as conn:
            row = await conn.fetchrow("SELECT robot_id, display_name FROM robots WHERE robot_id = $1", robot_id)
        if row is None:
            return None
        return await self._summarize(row["robot_id"], row["display_name"])

    async def get_telemetry(self, robot_id: str) -> Optional[dict]:
        raw = await self._redis.get(_key(robot_id, "telemetry"))
        return json.loads(raw) if raw else None

    async def get_health(self, robot_id: str) -> Optional[dict]:
        raw = await self._redis.get(_key(robot_id, "health"))
        return json.loads(raw) if raw else None

    async def get_lidar_scan(self, robot_id: str) -> Optional[dict]:
        raw = await self._redis.get(_key(robot_id, "lidar"))
        return json.loads(raw) if raw else None

    async def _summarize(self, robot_id: str, display_name: str) -> RobotSummary:
        status = await self._redis.get(_key(robot_id, "status"))
        last_seen_raw = await self._redis.get(_key(robot_id, "last_seen"))
        telemetry_raw = await self._redis.get(_key(robot_id, "telemetry"))

        battery_percentage = None
        if telemetry_raw:
            battery_percentage = json.loads(telemetry_raw).get("battery_percentage")

        return RobotSummary(
            robot_id=robot_id,
            display_name=display_name,
            status=status or "unknown",
            last_seen=_epoch_to_datetime(last_seen_raw),
            battery_percentage=battery_percentage,
        )


def _now_epoch() -> float:
    import time

    return time.time()


def _epoch_to_datetime(raw: Optional[str]) -> Optional[datetime]:
    if raw is None:
        return None
    return datetime.fromtimestamp(float(raw), tz=timezone.utc)
