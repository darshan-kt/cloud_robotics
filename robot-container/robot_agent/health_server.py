"""Local HTTP health/metrics endpoint for the CONTAINER orchestrator (Docker
HEALTHCHECK today, an ECS/Kubernetes liveness probe later) - a different
audience than the MQTT `health` topic, which reports to the fleet backend.
See docs/04-robot-agent.md for why these are two separate concepts.

Uses only the standard library on purpose: robot-container's tech stack
deliberately has no web framework, so this stays a ~60-line file instead of
pulling in a dependency for two GET endpoints.
"""
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional


class _Server(ThreadingHTTPServer):
    def __init__(self, address, handler_cls, status_provider: Callable[[], dict], metrics_provider: Callable[[], dict]):
        super().__init__(address, handler_cls)
        self.status_provider = status_provider
        self.metrics_provider = metrics_provider


class _Handler(BaseHTTPRequestHandler):
    server: _Server

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        if self.path == "/health":
            self._respond(200, self.server.status_provider())
        elif self.path == "/metrics":
            self._respond(200, self.server.metrics_provider())
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:
        # Silence BaseHTTPRequestHandler's default stderr access log - this
        # process logs through the structured JSON logger, not stdlib print.
        pass


class HealthServer:
    def __init__(
        self,
        port: int,
        status_provider: Callable[[], dict],
        metrics_provider: Callable[[], dict],
        logger: Optional[logging.Logger] = None,
    ):
        self._port = port
        self._logger = logger or logging.getLogger("robot_agent.health_server")
        self._httpd = _Server(("0.0.0.0", port), _Handler, status_provider, metrics_provider)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True, name="health-server")

    def start(self) -> None:
        self._thread.start()
        self._logger.info(f"Health server listening on :{self._port}")

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
