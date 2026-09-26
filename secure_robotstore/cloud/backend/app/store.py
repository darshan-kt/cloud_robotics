"""ReadingStore — the one place an inbound MQTT message becomes state.

This is the demo's equivalent of the real system's registry
(cloud-container/backend/app/registry/store.py): MQTTService knows how to
receive a message, this knows what a message *means*. Keeping the two apart
is why the WebSocket layer never touches paho and the MQTT layer never
touches Postgres.

One inbound reading fans out three ways:

    MQTT ─► ReadingStore ─┬─► Redis     (latest value + ring buffer)
                          ├─► Postgres  (durable history)
                          └─► Hub       (push to every open WebSocket)

The Hub is in-process, which is the honest limitation of this design: two
backend replicas would each only push to their own clients. The real fix is
Redis pub/sub between replicas, and it is written up as an intern task in
README.md rather than glossed over.
"""
import asyncio
import logging
from typing import Any

import asyncpg
import redis.asyncio as redis

from app.db import postgres, redis as redis_db
from app.mqtt.topics import INT_KIND, STRING_KIND

logger = logging.getLogger("backend.store")


class Hub:
    """Fan-out to every connected WebSocket, per data kind.

    Each subscriber gets its own bounded queue. Bounded matters: a browser
    on a slow connection that stops draining must not make the producer
    grow a list forever. When a queue is full the oldest reading is dropped,
    because for a live readout the newest value is the one that matters.
    """

    def __init__(self, maxsize: int = 100) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = {STRING_KIND: set(), INT_KIND: set()}
        self._maxsize = maxsize

    def subscribe(self, kind: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers[kind].add(queue)
        return queue

    def unsubscribe(self, kind: str, queue: asyncio.Queue) -> None:
        self._subscribers[kind].discard(queue)

    def publish(self, kind: str, reading: dict) -> None:
        for queue in self._subscribers.get(kind, set()):
            if queue.full():
                try:
                    queue.get_nowait()  # drop the oldest
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(reading)

    def subscriber_count(self) -> dict[str, int]:
        return {kind: len(subs) for kind, subs in self._subscribers.items()}


class ReadingStore:
    def __init__(
        self,
        pg_pool: asyncpg.Pool,
        redis_client: redis.Redis,
        hub: Hub,
        history_size: int,
    ) -> None:
        self._pg = pg_pool
        self._redis = redis_client
        self._hub = hub
        self._history_size = history_size

    async def record(self, device_id: str, kind: str, payload: dict[str, Any]) -> None:
        """Handle one inbound MQTT message. Registered in main.py.

        Validation is deliberately thin — enough to keep a malformed payload
        from crashing the handler, and no more. Hardening it is an intern
        task; see README.md.
        """
        value = payload.get("value")
        seq = payload.get("seq", 0)

        if kind == INT_KIND:
            try:
                value = int(value)
            except (TypeError, ValueError):
                logger.warning(f"dropping non-integer int reading: {payload!r}")
                return
        elif kind == STRING_KIND:
            if not isinstance(value, str):
                logger.warning(f"dropping non-string string reading: {payload!r}")
                return
            # INTERN TASK (security): no length cap. A device that publishes
            # a 10 MB string gets it written to Postgres, cached in Redis,
            # and pushed to every browser. The real backend caps input size.
        else:
            return

        try:
            seq = int(seq)
        except (TypeError, ValueError):
            seq = 0

        reading = {
            "device_id": device_id,
            "kind": kind,
            "value": value,
            "seq": seq,
            "recorded_at": payload.get("ts"),
        }

        # Redis first: it is what a newly-connected browser reads, so being
        # current there matters more than the durable write landing first.
        await redis_db.set_latest(self._redis, kind, reading, self._history_size)

        # Then the durable write. Isolated so a Postgres hiccup degrades the
        # system to "live data still flows, history has a gap" rather than
        # killing the message handler for every subsequent reading too.
        try:
            if kind == STRING_KIND:
                await postgres.insert_string_reading(self._pg, device_id, value, seq)
            else:
                await postgres.insert_int_reading(self._pg, device_id, value, seq)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"failed to persist {kind} reading seq={seq}: {exc}")

        # Finally the live push.
        self._hub.publish(kind, reading)
