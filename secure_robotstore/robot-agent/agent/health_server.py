"""A tiny HTTP health endpoint for the agent.

Mirrors robot-container/robot_agent/health_server.py. It exists so the
container has something to health-check and so you can answer "is the agent
alive but unable to reach the broker?" without reading logs — which is the
single most common failure in this stack while the broker is still booting.

Hand-rolled on asyncio's stream server rather than pulling in a web
framework: the device image should stay small, and this is ~30 lines.

INTERN TASK (security): binds 0.0.0.0 with no auth and reports internal
state. Decide what a device should expose and to whom.
"""
import asyncio
import json
import logging
from typing import Callable

logger = logging.getLogger("agent.health")


class HealthServer:
    def __init__(self, port: int, status_provider: Callable[[], dict]) -> None:
        self._port = port
        self._status = status_provider

    async def start(self) -> asyncio.AbstractServer:
        server = await asyncio.start_server(self._handle, "0.0.0.0", self._port)
        logger.info(f"health server listening on :{self._port}")
        return server

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            # Only the request line matters; read it and ignore the headers.
            request_line = await asyncio.wait_for(reader.readline(), timeout=5)
            if not request_line:
                return

            body = json.dumps(self._status()).encode()
            response = (
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: application/json\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n"
                b"Connection: close\r\n"
                b"\r\n" + body
            )
            writer.write(response)
            await writer.drain()
        except (asyncio.TimeoutError, ConnectionResetError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionResetError, BrokenPipeError):
                pass
