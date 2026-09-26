"""The once-per-second data source.

This stands in for whatever a real robot would read off its hardware — the
ROS 2 adapter in robot-container/robot_agent/. It produces one string
reading and one integer reading every second and publishes each on its own
MQTT topic.

Both readings carry a monotonically increasing `seq`. That is what makes
the demo debuggable: gaps in the sequence in the browser's window are
proof that messages were dropped somewhere between here and there, which
is otherwise very hard to tell apart from "the device is slow".
"""
import asyncio
import itertools
import logging
import random
from datetime import datetime, timezone

from agent.mqtt_client import MqttClient
from agent.topics import int_topic, string_topic

logger = logging.getLogger("agent.publisher")

# Rotated through so the string window shows visibly changing content
# rather than the same word with a new timestamp.
_STATES = [
    "idle",
    "scanning",
    "moving to waypoint",
    "obstacle detected",
    "recalculating route",
    "charging",
]


class Publisher:
    def __init__(self, client: MqttClient, device_id: str, interval_seconds: float = 1.0) -> None:
        self._client = client
        self._device_id = device_id
        self._interval = interval_seconds
        self._seq = itertools.count(1)
        # The integer walks rather than jumping randomly, so the numeric
        # window shows a plausible trend instead of noise.
        self._value = 50

    async def run(self) -> None:
        """Publish forever, once per `interval_seconds`.

        The sleep is computed from a target time rather than a flat
        `sleep(1)`, so the publish work itself doesn't make the cadence
        drift slower than 1 Hz over a long run.
        """
        logger.info(f"publishing every {self._interval}s as {self._device_id}")
        next_at = asyncio.get_running_loop().time()
        while True:
            next_at += self._interval
            self._publish_once()
            delay = next_at - asyncio.get_running_loop().time()
            if delay < 0:
                # Fell behind (a long GC pause, a stalled broker write).
                # Resync rather than burning through a backlog of ticks.
                next_at = asyncio.get_running_loop().time()
                delay = 0
            await asyncio.sleep(delay)

    def _publish_once(self) -> None:
        seq = next(self._seq)
        ts = datetime.now(timezone.utc).isoformat()

        state = _STATES[seq % len(_STATES)]
        self._client.publish(
            string_topic(self._device_id),
            {"value": f"{state} #{seq}", "seq": seq, "ts": ts},
        )

        # Random walk, clamped, so the value stays in a readable range.
        self._value = max(0, min(100, self._value + random.randint(-6, 6)))
        self._client.publish(
            int_topic(self._device_id),
            {"value": self._value, "seq": seq, "ts": ts},
        )

        if seq % 10 == 0:
            logger.info(f"published seq={seq} string={state!r} int={self._value}")
