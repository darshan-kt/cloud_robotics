"""Regression tests for the health server's authentication
(docs/security-findings.md F1).

Before this, /health and /metrics were served to anyone who asked, on
0.0.0.0, and /metrics includes robot_id - which IS the robot's MQTT
username (see cloud-container/mosquitto/docker-entrypoint-wrapper.sh and
the aclfile's %u pattern). These tests exist so that combination cannot
silently come back: each one fails if the protection is removed.

Runs a real HTTPServer on an ephemeral port and makes real HTTP requests -
the stdlib handler's behaviour is exactly what's under test, so stubbing it
out would test nothing.
"""
import json
import urllib.error
import urllib.request

import pytest

from robot_agent.health_server import HealthServer

STATUS = {"status": "ok", "robot_id": "turtlebot3_01", "mqtt_connected": True}
METRICS = {"commands_received": 42, "camera_frames_received": 1000}


def _server(auth_token: str = "") -> HealthServer:
    # Port 0 = let the OS pick a free one, so tests never collide.
    server = HealthServer(
        port=0,
        status_provider=lambda: dict(STATUS),
        metrics_provider=lambda: dict(METRICS),
        auth_token=auth_token,
    )
    server.start()
    return server


def _port(server: HealthServer) -> int:
    return server._httpd.server_address[1]


def _get(port: int, path: str, token: str = "") -> tuple[int, dict]:
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


@pytest.fixture
def unauthenticated():
    server = _server()
    yield _port(server)
    server.stop()


@pytest.fixture
def protected():
    server = _server(auth_token="s3cret-token")
    yield _port(server)
    server.stop()


# --- /health stays open on purpose: an orchestrator probe must not need a
#     secret. But it must not leak identity either. ---

def test_health_is_open_without_a_token(protected):
    status, body = _get(protected, "/health")

    assert status == 200
    assert body["status"] == "ok"


def test_health_never_leaks_robot_id_even_when_open(protected):
    """The whole point of F1: robot_id is also the MQTT username, so the
    one endpoint that stays unauthenticated must not carry it."""
    _status, body = _get(protected, "/health")

    assert "robot_id" not in body
    assert "mqtt_connected" not in body


# --- /metrics and /status carry identity, so they must be gated ---

@pytest.mark.parametrize("path", ["/metrics", "/status"])
def test_identity_bearing_endpoints_reject_a_missing_token(protected, path):
    status, _body = _get(protected, path)

    assert status == 401


@pytest.mark.parametrize("path", ["/metrics", "/status"])
def test_identity_bearing_endpoints_reject_a_wrong_token(protected, path):
    status, _body = _get(protected, path, token="not-the-token")

    assert status == 401


def test_metrics_returns_data_with_the_right_token(protected):
    status, body = _get(protected, "/metrics", token="s3cret-token")

    assert status == 200
    assert body["commands_received"] == 42


def test_status_returns_full_payload_with_the_right_token(protected):
    status, body = _get(protected, "/status", token="s3cret-token")

    assert status == 200
    assert body["robot_id"] == "turtlebot3_01"


# --- No token configured = open, which is what keeps local dev zero-config.
#     Deliberate, and tested so it stays deliberate rather than accidental. ---

def test_no_token_configured_leaves_metrics_open(unauthenticated):
    status, body = _get(unauthenticated, "/metrics")

    assert status == 200
    assert body["commands_received"] == 42


def test_unknown_path_is_404(protected):
    status, _body = _get(protected, "/nope")

    assert status == 404
