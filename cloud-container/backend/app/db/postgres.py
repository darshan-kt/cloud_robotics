"""PostgreSQL connection pool + schema management.

PostgreSQL is this backend's durable store - the "which robots exist and
who drove them when" system of record that must survive a container
restart. Redis (see db/redis.py) is deliberately NOT used for this: Redis
data here is either a cache of what Postgres already knows or genuinely
ephemeral (a live session lock, a robot's last-seen telemetry) - see
docs/07-cloud-backend.md for the full "why this table lives here, why that
key lives there" reasoning.

No migration framework (e.g. Alembic) yet - `CREATE TABLE IF NOT EXISTS` is
enough for this milestone's two tables and is idempotent across restarts.
A real production system would use real migrations; noted here rather than
smoothed over, matching this project's own documentation standard.
"""
import logging
from typing import Optional

import asyncpg

_SCHEMA = """
CREATE TABLE IF NOT EXISTS robots (
    robot_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'turtlebot3',
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_sessions (
    session_id UUID PRIMARY KEY,
    robot_id TEXT NOT NULL REFERENCES robots(robot_id),
    operator TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS control_sessions_robot_id_idx ON control_sessions (robot_id);
"""


async def create_pool(
    host: str,
    port: int,
    database: str,
    user: str,
    password: str,
    logger: Optional[logging.Logger] = None,
) -> asyncpg.Pool:
    logger = logger or logging.getLogger("backend.db.postgres")
    pool = await asyncpg.create_pool(
        host=host, port=port, database=database, user=user, password=password,
        min_size=1, max_size=10,
    )
    async with pool.acquire() as conn:
        await conn.execute(_SCHEMA)
    logger.info(f"Postgres pool ready ({host}:{port}/{database}), schema ensured")
    return pool
