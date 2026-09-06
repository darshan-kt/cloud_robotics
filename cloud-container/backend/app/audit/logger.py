"""Tamper-evident audit trail - Milestone 12.

Before this, "who commanded what, when" only ever existed as a line in
`logger.info()` output: readable, but not durable (log rotation, a
restarted container) and not tamper-evident (anyone with disk access could
edit it with no trace). For a system that drives physical hardware, that's
not enough - a real incident review, or a defense/regulated-environment
audit, needs to trust that a record wasn't quietly edited after the fact.

Each row is hash-chained like a minimal, single-writer blockchain:
`entry_hash = sha256(prev_hash + canonical_json(row))`. Editing or deleting
any row breaks every hash after it, so `scripts/verify-audit-log.py` can
detect tampering by simply recomputing the chain - it doesn't need a
separate signature or external log shipping to do that (though centralized,
immutable log shipping is still real future work - see
docs/12-security-hardening.md's deferred section).

Appends are serialized with a Postgres advisory lock (`pg_advisory_xact_lock`)
so two concurrent writers can't both read the same `prev_hash` and produce
two entries that both legitimately chain from it - the DB's own row
insertion order isn't enough to prevent that race on its own.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import asyncpg

_GENESIS_HASH = "0" * 64
_ADVISORY_LOCK_KEY = 0x415544_4954  # arbitrary constant ("AUDIT" in hex-ish), scoped to this one chain

logger = logging.getLogger("backend.audit")


def _entry_hash(prev_hash: str, ts: str, actor: str, action: str, robot_id: Optional[str], result: str, detail: dict) -> str:
    canonical = json.dumps(
        {"ts": ts, "actor": actor, "action": action, "robot_id": robot_id, "result": result, "detail": detail},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()


async def record(
    pg_pool: asyncpg.Pool,
    actor: str,
    action: str,
    result: str,
    robot_id: Optional[str] = None,
    detail: Optional[dict] = None,
) -> None:
    """Best-effort by design: a failure here (e.g. Postgres briefly
    unreachable) logs loudly but never blocks or fails the operation being
    audited - an emergency stop must still reach the robot even if its
    audit row can't be written, see the try/except at each call site."""
    detail = detail or {}
    ts = datetime.now(timezone.utc).isoformat()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _ADVISORY_LOCK_KEY)
            prev_hash = await conn.fetchval("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1")
            prev_hash = prev_hash or _GENESIS_HASH
            entry_hash = _entry_hash(prev_hash, ts, actor, action, robot_id, result, detail)
            await conn.execute(
                """
                INSERT INTO audit_log (ts, actor, action, robot_id, result, detail, prev_hash, entry_hash)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
                """,
                datetime.fromisoformat(ts), actor, action, robot_id, result, json.dumps(detail), prev_hash, entry_hash,
            )


async def record_safe(pg_pool: asyncpg.Pool, **kwargs) -> None:
    """record(), but swallows and logs any failure - see record()'s
    docstring for why an audit-log write must never block the real action."""
    try:
        await record(pg_pool, **kwargs)
    except Exception:
        logger.exception(f"Failed to write audit log entry: action={kwargs.get('action')!r}")
