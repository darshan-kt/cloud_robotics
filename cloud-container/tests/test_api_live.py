"""End-to-end HTTP/WebSocket test against the REAL running backend - the
closest thing this milestone has to Milestone 6's "verify against a real
browser": every other test proves one module works; this proves the
assembled system actually does, hit exactly the way a real client would.

Requires the full stack up: `docker compose up -d` (backend + mosquitto +
redis + postgres, and ideally the robot container too so there's a real
robot to see - skipped gracefully if the backend itself isn't reachable,
but the robot-specific assertions are best-effort if no robot ever
reported in).
"""
import os
import socket

import httpx
import pytest

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8000")
OPERATOR_USERNAME = os.environ.get("OPERATOR_USERNAME", "operator")
OPERATOR_PASSWORD = os.environ.get("OPERATOR_PASSWORD", "operator_dev_password")


def _reachable(url: str) -> bool:
    host_port = url.split("://", 1)[1]
    host, _, port = host_port.partition(":")
    try:
        with socket.create_connection((host, int(port or 80)), timeout=2):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module", autouse=True)
def _require_backend_reachable():
    if not _reachable(BASE_URL):
        pytest.skip(f"Backend not reachable at {BASE_URL} - run `docker compose up -d` first.")


def test_health_is_unauthenticated_and_ok():
    resp = httpx.get(f"{BASE_URL}/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "cloud-robotics-backend"


def test_robots_requires_auth():
    resp = httpx.get(f"{BASE_URL}/robots")
    assert resp.status_code == 401


def test_login_rejects_wrong_credentials():
    resp = httpx.post(f"{BASE_URL}/auth/login", json={"username": OPERATOR_USERNAME, "password": "wrong"})
    assert resp.status_code == 401


def test_login_succeeds_and_token_authorizes_robots_endpoint():
    login = httpx.post(
        f"{BASE_URL}/auth/login", json={"username": OPERATOR_USERNAME, "password": OPERATOR_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    resp = httpx.get(f"{BASE_URL}/robots", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_control_without_a_session_is_rejected():
    login = httpx.post(
        f"{BASE_URL}/auth/login", json={"username": OPERATOR_USERNAME, "password": OPERATOR_PASSWORD}
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    robots = httpx.get(f"{BASE_URL}/robots", headers=headers).json()
    if not robots:
        pytest.skip("No robot has reported in yet - bring up the robot container too to exercise this.")
    robot_id = robots[0]["robot_id"]

    resp = httpx.post(f"{BASE_URL}/robots/{robot_id}/control", headers=headers, json={"command": "forward"})
    assert resp.status_code == 403


def test_full_session_and_control_round_trip():
    login = httpx.post(
        f"{BASE_URL}/auth/login", json={"username": OPERATOR_USERNAME, "password": OPERATOR_PASSWORD}
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    robots = httpx.get(f"{BASE_URL}/robots", headers=headers).json()
    if not robots:
        pytest.skip("No robot has reported in yet - bring up the robot container too to exercise this.")
    robot_id = robots[0]["robot_id"]

    session = httpx.post(f"{BASE_URL}/robots/{robot_id}/session", headers=headers)
    assert session.status_code == 200
    assert session.json()["operator"] == OPERATOR_USERNAME

    control = httpx.post(
        f"{BASE_URL}/robots/{robot_id}/control", headers=headers, json={"command": "forward"}
    )
    assert control.status_code == 202

    detail = httpx.get(f"{BASE_URL}/robots/{robot_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["in_use_by"] == OPERATOR_USERNAME

    released = httpx.delete(f"{BASE_URL}/robots/{robot_id}/session", headers=headers)
    assert released.status_code == 204


def test_stop_bypasses_session_requirement():
    login = httpx.post(
        f"{BASE_URL}/auth/login", json={"username": OPERATOR_USERNAME, "password": OPERATOR_PASSWORD}
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    robots = httpx.get(f"{BASE_URL}/robots", headers=headers).json()
    if not robots:
        pytest.skip("No robot has reported in yet - bring up the robot container too to exercise this.")
    robot_id = robots[0]["robot_id"]

    resp = httpx.post(f"{BASE_URL}/robots/{robot_id}/stop", headers=headers)
    assert resp.status_code == 202
