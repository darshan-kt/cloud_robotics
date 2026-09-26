"""Local HTTP health/metrics endpoint for the CONTAINER orchestrator (Docker
HEALTHCHECK today, an ECS/Kubernetes liveness probe later) - a different
audience than the MQTT `health` topic, which reports to the fleet backend.
See docs/04-robot-agent.md for why these are two separate concepts.

Uses only the standard library on purpose: robot-container's tech stack
deliberately has no web framework, so this stays a short file instead of
pulling in a dependency for two GET endpoints.

Authentication (docs/security-findings.md F1): `/metrics` is protected by a
bearer token when ROBOT_HEALTH_TOKEN is set, because its payload includes
robot_id - which IS the robot's MQTT username - plus operational counters
that tell an attacker whether commands are flowing and whether anyone is
watching video. `/health` deliberately stays open and returns only liveness,
so container orchestrators (Docker HEALTHCHECK, a Kubernetes liveness probe)
keep working without being handed a credential. With no token configured
the behaviour is unchanged, which keeps local development zero-config -
but a real robot on a campus LAN must set one.
"""
import hmac
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional


class _Server(ThreadingHTTPServer):
    def __init__(
        self,
        address,
        handler_cls,
        status_provider: Callable[[], dict],
        metrics_provider: Callable[[], dict],
        auth_token: str = "",
    ):
        super().__init__(address, handler_cls)
        self.status_provider = status_provider
        self.metrics_provider = metrics_provider
        self.auth_token = auth_token


class _Handler(BaseHTTPRequestHandler):
    server: _Server

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        if self.path == "/health":
            # Liveness only, never gated: an orchestrator probe must not
            # need a secret, and this payload carries no identifying detail
            # beyond "the process is up".
            self._respond(200, {"status": self.server.status_provider().get("status", "ok")})
        elif self.path == "/metrics":
            if not self._authorized():
                self._respond(401, {"error": "unauthorized"})
                return
            self._respond(200, self.server.metrics_provider())
        elif self.path == "/status":
            # The full status payload (robot_id, mqtt_connected, uptime) -
            # same protection as /metrics, since this is what /health used
            # to return before it was narrowed to bare liveness.
            if not self._authorized():
                self._respond(401, {"error": "unauthorized"})
                return
            self._respond(200, self.server.status_provider())
        else:
            self._respond(404, {"error": "not found"})

    def _authorized(self) -> bool:
        """No token configured = open, preserving zero-config local dev.
        compare_digest rather than == so a wrong token can't be recovered
        one character at a time from response timing."""
        token = self.server.auth_token
        if not token:
            return True
        return hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}")

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
        auth_token: str = "",
    ):
        self._port = port
        self._auth_token = auth_token
        self._logger = logger or logging.getLogger("robot_agent.health_server")
        # Still 0.0.0.0 inside the container: Docker's port publishing
        # forwards to the container's own interface, not its loopback, so
        # binding 127.0.0.1 here would break both `make health` and the
        # HEALTHCHECK. The exposure is contained by publishing the port to
        # the host's loopback only (docker-compose.yml) and by auth_token
        # on the endpoints that actually carry identity.
        self._httpd = _Server(("0.0.0.0", port), _Handler, status_provider, metrics_provider, auth_token)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True, name="health-server")

    def start(self) -> None:
        self._thread.start()
        protection = "token-protected" if self._auth_token else "UNAUTHENTICATED (set ROBOT_HEALTH_TOKEN)"
        self._logger.info(f"Health server listening on :{self._port} - /metrics and /status {protection}")

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
