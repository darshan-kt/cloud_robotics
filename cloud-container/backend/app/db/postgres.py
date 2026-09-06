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

-- Tamper-evident audit trail (Milestone 12) - every login attempt, session
-- acquire/release, and command (including emergency stop) gets an
-- append-only row here, hash-chained via prev_hash/entry_hash so any later
-- edit or deletion breaks the chain from that point forward. See
-- app/audit/logger.py and scripts/verify-audit-log.py.
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    robot_id TEXT,
    result TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log (ts);
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
