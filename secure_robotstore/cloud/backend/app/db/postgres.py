"""PostgreSQL pool + schema.

The durable half of the storage split, same reasoning as the real system
(cloud-container/backend/app/db/postgres.py): Postgres is the system of
record that must survive a container restart. Redis holds what is live and
re-derivable. If you are unsure which a new piece of data belongs in, ask
whether losing it on restart would be a bug — if yes, it goes here.

No migration framework: `CREATE TABLE IF NOT EXISTS` is idempotent and
enough for two tables. A real system uses real migrations; the real backend
says the same thing in the same place rather than pretending otherwise.
"""
import logging

import asyncpg

logger = logging.getLogger("backend.db.postgres")

# Two tables, one per data kind. They could be one table with a `kind`
# column and a text value; they are split because the integer readings get
# an actual INTEGER column, which means the database can do arithmetic on
# them (avg, max, range queries) instead of casting text at query time.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS string_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    value TEXT NOT NULL,
    seq BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS string_readings_recorded_at_idx
    ON string_readings (recorded_at DESC);

CREATE TABLE IF NOT EXISTS int_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    value INTEGER NOT NULL,
    seq BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS int_readings_recorded_at_idx
    ON int_readings (recorded_at DESC);
"""


async def create_pool(
    host: str, port: int, database: str, user: str, password: str
) -> asyncpg.Pool:
    # The device publishes every second forever, so Postgres may well not be
    # accepting connections yet when the backend starts. Retry rather than
    # crash-looping the container.
    last_error: Exception | None = None
    for attempt in range(1, 11):
        try:
            pool = await asyncpg.create_pool(
                host=host,
                port=port,
                database=database,
                user=user,
                password=password,
                min_size=1,
                max_size=5,
            )
            break
        except Exception as exc:  # noqa: BLE001 — any connection failure is retryable here
            last_error = exc
            logger.warning(f"postgres not ready (attempt {attempt}/10): {exc}")
            await _sleep(2)
    else:
        raise RuntimeError(f"could not reach postgres: {last_error}")

    async with pool.acquire() as conn:
        await conn.execute(_SCHEMA)
    logger.info(f"postgres pool ready ({host}:{port}/{database})")
    return pool


async def _sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


# ---- writes ---------------------------------------------------------------


async def insert_string_reading(pool: asyncpg.Pool, device_id: str, value: str, seq: int) -> None:
    # INTERN TASK (security): this is parameterised ($1/$2/$3), which is the
    # correct shape — asyncpg never interpolates values into the SQL text.
    # Keep it that way: the tempting f-string version here is a textbook
    # injection hole, and `value` arrives straight off the broker.
    await pool.execute(
        "INSERT INTO string_readings (device_id, value, seq) VALUES ($1, $2, $3)",
        device_id,
        value,
        seq,
    )


async def insert_int_reading(pool: asyncpg.Pool, device_id: str, value: int, seq: int) -> None:
    await pool.execute(
        "INSERT INTO int_readings (device_id, value, seq) VALUES ($1, $2, $3)",
        device_id,
        value,
        seq,
    )


# ---- reads ----------------------------------------------------------------


async def recent_string_readings(pool: asyncpg.Pool, limit: int = 50) -> list[dict]:
    rows = await pool.fetch(
        "SELECT device_id, value, seq, recorded_at FROM string_readings "
        "ORDER BY id DESC LIMIT $1",
        limit,
    )
    return [_row_to_dict(r) for r in rows]


async def recent_int_readings(pool: asyncpg.Pool, limit: int = 50) -> list[dict]:
    rows = await pool.fetch(
        "SELECT device_id, value, seq, recorded_at FROM int_readings "
        "ORDER BY id DESC LIMIT $1",
        limit,
    )
    return [_row_to_dict(r) for r in rows]


async def counts(pool: asyncpg.Pool) -> dict[str, int]:
    row = await pool.fetchrow(
        "SELECT (SELECT count(*) FROM string_readings) AS strings, "
        "       (SELECT count(*) FROM int_readings) AS ints"
    )
    return {"string_rows": row["strings"], "int_rows": row["ints"]}


def _row_to_dict(row: asyncpg.Record) -> dict:
    return {
        "device_id": row["device_id"],
        "value": row["value"],
        "seq": row["seq"],
        "recorded_at": row["recorded_at"].isoformat(),
    }
