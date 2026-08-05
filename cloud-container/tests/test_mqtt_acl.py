"""MQTT authentication + ACL integration tests (Milestone 3).

These prove the security model documented in docs/03-mqtt-layer.md is real,
not just correctly-looking config: unauthenticated/misauthenticated clients
are rejected, each role can do exactly what its topic contract says, and
nothing more.

Requires a live broker: `docker compose up -d` first. This is an
integration test against the real Mosquitto container, not a unit test -
see cloud-container/tests/README.md.

MQTT 3.1.1 quirk this file works around: a denied PUBLISH is dropped
silently by the broker - the publisher gets no error. So "this client
should NOT be able to publish here" is proven by having a legitimately
subscribed *observer* client confirm the message never arrives, always
paired with a positive control case proving the observer/test harness
itself works (otherwise "nothing arrived" could just mean the test is
broken, not that the ACL denial worked).
"""
import json
import os
import socket
import threading
import time
import uuid
from contextlib import contextmanager

import paho.mqtt.client as mqtt
import pytest

BROKER_HOST = os.environ.get("MQTT_TEST_HOST", "localhost")
BROKER_PORT = int(os.environ.get("MQTT_TEST_PORT", "1883"))

ROBOT_ID = os.environ.get("ROBOT_ID", "turtlebot3_01")
ROBOT_PASSWORD = os.environ.get("MQTT_ROBOT_PASSWORD", "robot_dev_password")
BACKEND_USERNAME = os.environ.get("MQTT_BACKEND_USERNAME", "backend")
BACKEND_PASSWORD = os.environ.get("MQTT_BACKEND_PASSWORD", "backend_dev_password")

CONNECT_TIMEOUT = 5
MESSAGE_TIMEOUT = 2

SUBACK_DENIED = 128  # 0x80: broker refused the subscription (too broad for the ACL)


@pytest.fixture(scope="module", autouse=True)
def _require_broker_reachable():
    try:
        with socket.create_connection((BROKER_HOST, BROKER_PORT), timeout=2):
            pass
    except OSError:
        pytest.skip(
            f"MQTT broker not reachable at {BROKER_HOST}:{BROKER_PORT} - "
            "run `docker compose up -d` first (see docs/03-mqtt-layer.md)."
        )


@contextmanager
def mqtt_client(username: str | None = None, password: str | None = None):
    """Connects, yields (client, connack_rc), always cleans up on exit."""
    client = mqtt.Client(client_id=f"test-{uuid.uuid4().hex[:8]}")
    if username is not None:
        client.username_pw_set(username, password)

    connected = threading.Event()
    state = {"rc": None}

    def on_connect(c, userdata, flags, rc):
        state["rc"] = rc
        connected.set()

    client.on_connect = on_connect
    client.connect(BROKER_HOST, BROKER_PORT, keepalive=10)
    client.loop_start()

    if not connected.wait(CONNECT_TIMEOUT):
        client.loop_stop()
        pytest.fail("Timed out waiting for CONNACK")

    try:
        yield client, state["rc"]
    finally:
        client.loop_stop()
        try:
            client.disconnect()
        except Exception:
            pass


def _wait_until(predicate, timeout: float = MESSAGE_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return predicate()


def test_anonymous_connection_is_rejected():
    with mqtt_client() as (_client, rc):
        assert rc != 0, "anonymous clients must be rejected (allow_anonymous is false)"


def test_wrong_password_is_rejected():
    with mqtt_client(username=ROBOT_ID, password="definitely-wrong-password") as (_client, rc):
        assert rc != 0, "a bad password must be rejected"


def test_robot_command_delivery_round_trip():
    """Backend -> robots/{id}/cmd -> robot: the actual command delivery path."""
    with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
        assert robot_rc == 0
        received = []
        robot.on_message = lambda c, u, msg: received.append(msg.payload)
        robot.subscribe(f"robots/{ROBOT_ID}/cmd", qos=1)
        time.sleep(0.3)  # let the SUBACK land before backend publishes

        with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (backend, backend_rc):
            assert backend_rc == 0
            backend.publish(
                f"robots/{ROBOT_ID}/cmd",
                json.dumps({"command": "stop", "issued_at": time.time()}),
                qos=1,
            )

        assert _wait_until(lambda: len(received) > 0), (
            "the robot should receive commands the backend addresses to its own topic"
        )


def test_robot_cannot_publish_outside_own_namespace():
    foreign_robot_id = "not-a-provisioned-robot"
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (observer, observer_rc):
        assert observer_rc == 0
        received = {"own": [], "foreign": []}

        def on_message(c, u, msg):
            if msg.topic == f"robots/{ROBOT_ID}/heartbeat":
                received["own"].append(msg)
            elif msg.topic == f"robots/{foreign_robot_id}/heartbeat":
                received["foreign"].append(msg)

        observer.on_message = on_message
        observer.subscribe("robots/+/heartbeat", qos=1)  # backend's real read grant
        time.sleep(0.3)

        with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
            assert robot_rc == 0
            robot.publish(f"robots/{ROBOT_ID}/heartbeat", "legitimate", qos=1)
            robot.publish(f"robots/{foreign_robot_id}/heartbeat", "spoofed", qos=1)

        # Positive control first: if this never arrives, the harness itself
        # is broken and the "foreign" assertion below would be meaningless.
        assert _wait_until(lambda: len(received["own"]) > 0), (
            "control case failed: a legitimate publish never arrived - "
            "test harness or ACL config is broken, not just the denial case"
        )
        assert not received["foreign"], (
            "a robot must not be able to publish into another robot's namespace"
        )


def test_robot_broad_subscription_is_still_filtered_at_delivery():
    """A robot subscribing with a wildcard broader than its own %u pattern
    (e.g. robots/+/cmd instead of robots/{id}/cmd) gets a granted SUBACK -
    Mosquitto doesn't evaluate %u patterns against the subscription filter
    itself. The ACL boundary holds anyway: it's enforced again per-message
    at delivery time, so the robot still never actually receives another
    robot's messages. Verified empirically before writing this assertion -
    see docs/03-mqtt-layer.md."""
    foreign_robot_id = "not-a-provisioned-robot"
    with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
        assert robot_rc == 0
        granted = []
        received = []
        robot.on_subscribe = lambda c, u, mid, granted_qos: granted.extend(granted_qos)
        robot.on_message = lambda c, u, msg: received.append(msg.topic)
        robot.subscribe("robots/+/cmd", qos=1)  # broader than robots/%u/cmd

        assert _wait_until(lambda: len(granted) > 0), "expected a SUBACK"
        assert granted[0] != SUBACK_DENIED, (
            "Mosquitto grants wildcard subscriptions even when broader than a "
            "%u pattern - the boundary is enforced at delivery, not here"
        )

        with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (backend, backend_rc):
            assert backend_rc == 0
            backend.publish(f"robots/{foreign_robot_id}/cmd", "not-for-you", qos=1)
            backend.publish(f"robots/{ROBOT_ID}/cmd", "for-you", qos=1)

        assert _wait_until(lambda: f"robots/{ROBOT_ID}/cmd" in received), (
            "control case failed: the robot's own cmd message never arrived"
        )
        assert f"robots/{foreign_robot_id}/cmd" not in received, (
            "an over-broad subscription must not leak another robot's messages"
        )


def test_backend_cannot_publish_robot_telemetry():
    """Backend has `read` on telemetry, not `readwrite` - it must not be
    able to impersonate a robot's own reported state.

    Asserts the SPOOFED PAYLOAD specifically never arrives, not "nothing
    arrives at all" - as of Milestone 7, this topic legitimately carries
    the real robot's own telemetry once every second whenever the full
    stack is up (which it normally is, for the backend's own live
    integration tests - see cloud-container/tests/test_registry_and_
    sessions_live.py). An earlier version of this test asserted zero
    messages received at all, which is correct in isolation but is a
    false failure the moment a real robot is also running and publishing
    its own legitimate telemetry during the test window - confirmed
    directly by inspecting a "failure"'s received payloads, which turned
    out to be genuine robot telemetry, not the spoofed one."""
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (observer, observer_rc):
        assert observer_rc == 0
        received = []
        observer.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        observer.subscribe(f"robots/{ROBOT_ID}/telemetry", qos=1)
        time.sleep(0.3)

        spoofed_payload = '{"spoofed": true}'
        with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (publisher, publisher_rc):
            assert publisher_rc == 0
            publisher.publish(f"robots/{ROBOT_ID}/telemetry", spoofed_payload, qos=1)

        time.sleep(MESSAGE_TIMEOUT)
        assert spoofed_payload not in received, (
            "backend must not be able to publish (impersonate) robot telemetry"
        )


# --- WebRTC signalling (Milestone 8) - camera/offer (backend -> robot) and
# camera/answer (robot -> backend), see docs/08-webrtc-signalling.md and
# aclfile's comment on why backend originating an offer isn't the same
# risk category as backend originating telemetry. ---
def test_backend_can_publish_camera_offer_and_robot_receives_it():
    with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
        assert robot_rc == 0
        received = []
        robot.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        robot.subscribe(f"robots/{ROBOT_ID}/camera/offer", qos=1)
        time.sleep(0.3)

        with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (backend, backend_rc):
            assert backend_rc == 0
            backend.publish(f"robots/{ROBOT_ID}/camera/offer", '{"request_id":"r1","sdp":"offer"}', qos=1)

        assert _wait_until(lambda: len(received) > 0), (
            "the robot should receive a WebRTC offer the backend addresses to its own topic"
        )


def test_robot_cannot_publish_camera_offer():
    """The robot only has read on its own camera/offer - it must not be
    able to publish there (only the backend originates offers)."""
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (observer, observer_rc):
        assert observer_rc == 0
        received = []
        observer.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        observer.subscribe(f"robots/{ROBOT_ID}/camera/offer", qos=1)
        time.sleep(0.3)

        spoofed_payload = '{"spoofed": true}'
        with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
            assert robot_rc == 0
            robot.publish(f"robots/{ROBOT_ID}/camera/offer", spoofed_payload, qos=1)

        time.sleep(MESSAGE_TIMEOUT)
        assert spoofed_payload not in received, "a robot must not be able to publish its own camera/offer"


def test_robot_can_publish_camera_answer_and_backend_receives_it():
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (backend, backend_rc):
        assert backend_rc == 0
        received = []
        backend.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        backend.subscribe(f"robots/{ROBOT_ID}/camera/answer", qos=1)
        time.sleep(0.3)

        with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
            assert robot_rc == 0
            robot.publish(f"robots/{ROBOT_ID}/camera/answer", '{"request_id":"r1","sdp":"answer"}', qos=1)

        assert _wait_until(lambda: len(received) > 0), (
            "the backend should receive the robot's WebRTC answer"
        )


# --- LIDAR (post-Milestone-11) - robot -> backend, same read-only-for-
# backend shape as telemetry/health/status, see aclfile's comment on why
# self-reported robot state is never something the backend may originate. ---
def test_robot_can_publish_lidar_and_backend_receives_it():
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (backend, backend_rc):
        assert backend_rc == 0
        received = []
        backend.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        backend.subscribe(f"robots/{ROBOT_ID}/lidar", qos=1)
        time.sleep(0.3)

        with mqtt_client(username=ROBOT_ID, password=ROBOT_PASSWORD) as (robot, robot_rc):
            assert robot_rc == 0
            robot.publish(f"robots/{ROBOT_ID}/lidar", '{"ranges":[1.0,2.0]}', qos=0)

        assert _wait_until(lambda: len(received) > 0), (
            "the backend should receive the robot's own lidar scans"
        )


def test_backend_cannot_publish_lidar():
    """Same "can't impersonate what only the robot should originate"
    principle as telemetry/health/status/camera-answer - see
    test_backend_cannot_publish_robot_telemetry above for why this asserts
    the specific spoofed payload never arrives rather than "nothing
    arrives at all" (a real robot may legitimately be publishing lidar
    scans during this test's window too)."""
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (observer, observer_rc):
        assert observer_rc == 0
        received = []
        observer.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        observer.subscribe(f"robots/{ROBOT_ID}/lidar", qos=1)
        time.sleep(0.3)

        spoofed_payload = '{"spoofed": true}'
        with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (publisher, publisher_rc):
            assert publisher_rc == 0
            publisher.publish(f"robots/{ROBOT_ID}/lidar", spoofed_payload, qos=0)

        time.sleep(MESSAGE_TIMEOUT)
        assert spoofed_payload not in received, (
            "backend must not be able to publish (impersonate) a robot's lidar scan"
        )


def test_backend_cannot_publish_camera_answer():
    """Backend has `read` on camera/answer, not `readwrite` - same
    "can't impersonate what only the robot should originate" principle as
    telemetry/health/status, see test_backend_cannot_publish_robot_telemetry
    above for why this asserts the specific spoofed payload never arrives
    rather than "nothing arrives at all"."""
    with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (observer, observer_rc):
        assert observer_rc == 0
        received = []
        observer.on_message = lambda c, u, msg: received.append(msg.payload.decode())
        observer.subscribe(f"robots/{ROBOT_ID}/camera/answer", qos=1)
        time.sleep(0.3)

        spoofed_payload = '{"spoofed": true}'
        with mqtt_client(username=BACKEND_USERNAME, password=BACKEND_PASSWORD) as (publisher, publisher_rc):
            assert publisher_rc == 0
            publisher.publish(f"robots/{ROBOT_ID}/camera/answer", spoofed_payload, qos=1)

        time.sleep(MESSAGE_TIMEOUT)
        assert spoofed_payload not in received, (
            "backend must not be able to publish (impersonate) a robot's WebRTC answer"
        )
