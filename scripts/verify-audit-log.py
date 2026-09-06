#!/usr/bin/env python3
"""Walks audit_log's hash chain (see cloud-container/backend/app/audit/logger.py)
and reports the first broken link, if any - a real forensic tool, not a
demonstration. Exit code 0 = chain intact, 1 = tampering detected, 2 = could
not connect.

Run it the same way the backend itself reaches Postgres - from inside the
network the backend runs on, since Postgres is loopback-only on the host
since Milestone 12 (see docs/12-security-hardening.md):

    docker compose exec backend python -m scripts_inline_verify   # not wired up as a module;
    # simplest is to run it against the loopback-published port from the host instead:
    POSTGRES_PASSWORD=... python3 scripts/verify-audit-log.py

Reads the same POSTGRES_* env vars as the rest of this project
(.env/.env.example) - defaults match docker-compose.yml's own defaults.
"""
import hashlib
import json
import os
import sys

try:
    import asyncpg
except ImportError:
    print("This script needs asyncpg: pip install asyncpg", file=sys.stderr)
    sys.exit(2)

import asyncio

_GENESIS_HASH = "0" * 64

POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.environ.get("POSTGRES_DB", "cloud_robotics")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "robotics")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "robotics_dev_password")


def _entry_hash(prev_hash: str, row) -> str:
    canonical = json.dumps(
        {
            "ts": row["ts"].isoformat(),
            "actor": row["actor"],
            "action": row["action"],
            "robot_id": row["robot_id"],
            "result": row["result"],
            "detail": json.loads(row["detail"]) if isinstance(row["detail"], str) else row["detail"],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()


async def main() -> int:
    try:
        conn = await asyncpg.connect(
            host=POSTGRES_HOST, port=POSTGRES_PORT, database=POSTGRES_DB,
            user=POSTGRES_USER, password=POSTGRES_PASSWORD,
        )
    except Exception as exc:
        print(f"Could not connect to Postgres ({POSTGRES_HOST}:{POSTGRES_PORT}): {exc}", file=sys.stderr)
        return 2

    try:
        rows = await conn.fetch("SELECT * FROM audit_log ORDER BY id ASC")
    finally:
        await conn.close()

    if not rows:
        print("audit_log is empty - nothing to verify (this is not an error).")
        return 0

    prev_hash = _GENESIS_HASH
    for row in rows:
        expected = _entry_hash(prev_hash, row)
        if row["prev_hash"] != prev_hash or row["entry_hash"] != expected:
            print(f"TAMPERING DETECTED at audit_log.id={row['id']} (action={row['action']!r}, actor={row['actor']!r}):")
            print(f"  expected prev_hash={prev_hash}, entry_hash={expected}")
            print(f"  found    prev_hash={row['prev_hash']}, entry_hash={row['entry_hash']}")
            return 1
        prev_hash = row["entry_hash"]

    print(f"OK - {len(rows)} audit_log entries verified, chain intact.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
