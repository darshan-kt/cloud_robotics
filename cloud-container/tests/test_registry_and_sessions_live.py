"""Integration tests for registry/store.py and sessions/manager.py against
a REAL live Postgres + Redis - proving the actual SQL and Redis behavior
is correct, not just that FleetManager calls the right fake methods (see
test_fleet_manager.py for that half, and cloud-container/tests/README.md
for the unit-vs-integration split this project follows).

Requires `docker compose up -d postgres redis` first - same
skip-if-unreachable pattern as test_mqtt_acl.py.
"""
import asyncio
import os
import socket
import time
import uuid

import asyncpg
import pytest
import redis.asyncio as redis

from app.registry.store import RobotRegistry
from app.sessions.manager import SessionConflictError, SessionManager

POSTGRES_HOST = os.environ.get("POSTGRES_TEST_HOST", "localhost")
POSTGRES_PORT = int(os.environ.get("POSTGRES_TEST_PORT", "5432"))
POSTGRES_DB = os.environ.get("POSTGRES_DB", "cloud_robotics")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "robotics")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "robotics_dev_password")

REDIS_HOST = os.environ.get("REDIS_TEST_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_TEST_PORT", "6379"))


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module", autouse=True)
def _require_live_stores():
    if not (_reachable(POSTGRES_HOST, POSTGRES_PORT) and _reachable(REDIS_HOST, REDIS_PORT)):
        pytest.skip(
            f"Postgres ({POSTGRES_HOST}:{POSTGRES_PORT}) or Redis ({REDIS_HOST}:{REDIS_PORT}) not "
            "reachable - run `docker compose up -d postgres redis` first (see docs/07-cloud-backend.md)."
        )


@pytest.fixture
async def pg_pool():
    from app.db.postgres import create_pool

    pool = await create_pool(POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD)
    yield pool
    await pool.close()


@pytest.fixture
async def redis_client():
    client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    yield client
    await client.aclose()


def _unique_robot_id() -> str:
    return f"test-robot-{uuid.uuid4().hex[:8]}"


async def _cleanup_robot(pg_pool: asyncpg.Pool, redis_client: redis.Redis, robot_id: str) -> None:
    async with pg_pool.acquire() as conn:
        await conn.execute("DELETE FROM control_sessions WHERE robot_id = $1", robot_id)
        await conn.execute("DELETE FROM robots WHERE robot_id = $1", robot_id)
    for field in ("status", "last_seen", "telemetry", "health"):
        await redis_client.delete(f"robot:{robot_id}:{field}")
    await redis_client.delete(f"session:{robot_id}")


async def test_record_status_auto_registers_and_is_readable(pg_pool, redis_client):
    robot_id = _unique_robot_id()
    registry = RobotRegistry(pg_pool, redis_client)
    try:
        await registry.record_status(robot_id, {"status": "online", "timestamp": time.time()})

        summary = await registry.get_robot(robot_id)
        assert summary is not None
        assert summary.status == "online"
        assert summary.last_seen is not None
    finally:
        await _cleanup_robot(pg_pool, redis_client, robot_id)


async def test_record_telemetry_surfaces_battery_percentage(pg_pool, redis_client):
    robot_id = _unique_robot_id()
    registry = RobotRegistry(pg_pool, redis_client)
    try:
        await registry.record_status(robot_id, {"status": "online", "timestamp": time.time()})
        await registry.record_telemetry(
            robot_id, {"timestamp": time.time(), "battery_percentage": 42.5}
        )

        summary = await registry.get_robot(robot_id)
        assert summary.battery_percentage == 42.5
    finally:
        await _cleanup_robot(pg_pool, redis_client, robot_id)


async def test_unknown_robot_returns_none(pg_pool, redis_client):
    registry = RobotRegistry(pg_pool, redis_client)

    assert await registry.get_robot("definitely-not-a-real-robot") is None


async def test_session_acquire_is_exclusive(pg_pool, redis_client):
    robot_id = _unique_robot_id()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO robots (robot_id, display_name) VALUES ($1, $1) ON CONFLICT DO NOTHING", robot_id
        )
    sessions = SessionManager(pg_pool, redis_client, ttl_seconds=30)
    try:
        info = await sessions.acquire(robot_id, "alice")
        assert info.operator == "alice"

        with pytest.raises(SessionConflictError):
            await sessions.acquire(robot_id, "bob")

        # Re-acquiring as the SAME operator is idempotent, not a conflict -
        # a reconnecting browser tab shouldn't be locked out of its own session.
        info2 = await sessions.acquire(robot_id, "alice")
        assert info2.session_id == info.session_id
    finally:
        await _cleanup_robot(pg_pool, redis_client, robot_id)


async def test_session_release_then_reacquire_by_someone_else(pg_pool, redis_client):
    robot_id = _unique_robot_id()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO robots (robot_id, display_name) VALUES ($1, $1) ON CONFLICT DO NOTHING", robot_id
        )
    sessions = SessionManager(pg_pool, redis_client, ttl_seconds=30)
    try:
        await sessions.acquire(robot_id, "alice")
        await sessions.release(robot_id, "alice")

        info = await sessions.acquire(robot_id, "bob")
        assert info.operator == "bob"

        async with pg_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT ended_at FROM control_sessions WHERE robot_id = $1 AND operator = 'alice'", robot_id
            )
        assert row["ended_at"] is not None
    finally:
        await _cleanup_robot(pg_pool, redis_client, robot_id)


async def test_session_expires_via_ttl_without_explicit_release(pg_pool, redis_client):
    robot_id = _unique_robot_id()
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO robots (robot_id, display_name) VALUES ($1, $1) ON CONFLICT DO NOTHING", robot_id
        )
    sessions = SessionManager(pg_pool, redis_client, ttl_seconds=1)
    try:
        await sessions.acquire(robot_id, "alice")
        await asyncio.sleep(1.5)

        assert await sessions.get_holder(robot_id) is None
        # And someone else can now take over without ever calling release().
        info = await sessions.acquire(robot_id, "bob")
        assert info.operator == "bob"
    finally:
        await _cleanup_robot(pg_pool, redis_client, robot_id)
