"""Watches MQTT connection health and triggers a reconnect if it's been down
too long. paho's own reconnect_delay_set() keeps retrying the TCP/MQTT
handshake in the background regardless - this is the layer that notices
"we've been disconnected for N seconds" and does something louder about it:
logs a warning and asks the agent to restart the connection outright.

Constructor-injected callables (is_connected, on_unhealthy) rather than a
reference to RobotCloudAgent itself, so this can be unit-tested in complete
isolation - see docs/04-robot-agent.md.
"""
import asyncio
import logging
from typing import Awaitable, Callable, Optional


class Watchdog:
    def __init__(
        self,
        is_connected: Callable[[], bool],
        on_unhealthy: Callable[[], Awaitable[None]],
        check_interval_seconds: float,
        unhealthy_after_seconds: float,
        logger: Optional[logging.Logger] = None,
    ):
        self._is_connected = is_connected
        self._on_unhealthy = on_unhealthy
        self._check_interval = check_interval_seconds
        self._unhealthy_after = unhealthy_after_seconds
        self._logger = logger or logging.getLogger("robot_agent.watchdog")
        self._disconnected_since: Optional[float] = None

    async def run(self, stop_event: asyncio.Event) -> None:
        loop = asyncio.get_running_loop()
        while not stop_event.is_set():
            now = loop.time()
            if self._is_connected():
                self._disconnected_since = None
            else:
                if self._disconnected_since is None:
                    self._disconnected_since = now
                down_for = now - self._disconnected_since
                if down_for >= self._unhealthy_after:
                    self._logger.warning(
                        f"MQTT has been disconnected for {down_for:.0f}s - triggering restart"
                    )
                    await self._on_unhealthy()
                    self._disconnected_since = None
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self._check_interval)
            except asyncio.TimeoutError:
                pass
