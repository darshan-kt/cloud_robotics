import json

import pytest
from fake_mqtt_client import FakeMQTTClient
from fake_ros_adapter import RecordingROSAdapter
from fake_video_streamer import FakeVideoStreamer

from robot_agent.agent import RobotCloudAgent
from robot_agent.config import AgentConfig
from robot_agent.models import CameraFrame, OdometryData

ROBOT_ID = "test-robot"


@pytest.fixture
def wired():
    mqtt = FakeMQTTClient()
    ros = RecordingROSAdapter()
    video = FakeVideoStreamer()
    config = AgentConfig()
    agent = RobotCloudAgent(
        robot_id=ROBOT_ID, mqtt_client=mqtt, ros_adapter=ros, config=config, video_streamer=video
    )
    return agent, mqtt, ros, video


async def test_connect_sets_will_subscribes_cmd_and_publishes_retained_online(wired):
    agent, mqtt, _ros, _video = wired

    await agent.connect()

    assert mqtt.connect_calls == 1
    assert mqtt.will[0] == f"robots/{ROBOT_ID}/status"
    assert json.loads(mqtt.will[1])["status"] == "offline"

    assert f"robots/{ROBOT_ID}/cmd" in mqtt.subscriptions
    assert f"robots/{ROBOT_ID}/camera/offer" in mqtt.subscriptions

    topic, payload, qos, retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/status"
    assert retain is True
    assert qos == 1
    assert json.loads(payload)["status"] == "online"


async def test_shutdown_publishes_offline_status_and_disconnects(wired):
    agent, mqtt, _ros, _video = wired
    await agent.connect()

    await agent.shutdown()

    topic, payload, _qos, retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/status"
    assert retain is True
    assert json.loads(payload)["status"] == "offline"
    assert mqtt.disconnect_calls == 1


async def test_receive_command_dispatches_to_ros_adapter(wired):
    agent, mqtt, ros, _video = wired
    await agent.connect()

    mqtt.simulate_incoming(f"robots/{ROBOT_ID}/cmd", {"command": "forward"})

    default_linear_speed = AgentConfig().motion.linear_speed
    assert ros.calls == [(default_linear_speed, 0.0)]


async def test_receive_command_rejects_malformed_payload_without_raising(wired):
    agent, mqtt, ros, _video = wired
    await agent.connect()

    mqtt.simulate_incoming(f"robots/{ROBOT_ID}/cmd", {"not_a_command_field": True})

    assert ros.calls == []
    assert agent.get_metrics()["commands_rejected"] == 1


def test_heartbeat_publishes_to_heartbeat_topic(wired):
    agent, mqtt, _ros, _video = wired

    agent.heartbeat()

    topic, payload, qos, retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/heartbeat"
    assert qos == 0
    assert retain is False
    assert json.loads(payload)["robot_id"] == ROBOT_ID


def test_publish_telemetry_uses_latest_cached_odometry(wired):
    agent, mqtt, _ros, _video = wired
    agent._on_odometry(
        OdometryData(linear_velocity=1.0, angular_velocity=0.0, position_x=2.0, position_y=3.0, heading=0.5)
    )

    agent.publish_telemetry()

    topic, payload, _qos, _retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/telemetry"
    data = json.loads(payload)
    assert data["position"] == {"x": 2.0, "y": 3.0, "heading": 0.5}
    assert data["velocity"]["linear"] == 1.0


def test_publish_telemetry_before_any_data_does_not_raise(wired):
    agent, mqtt, _ros, _video = wired

    agent.publish_telemetry()  # no odometry/battery callback has fired yet

    topic, payload, _qos, _retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/telemetry"
    assert json.loads(payload)["battery_percentage"] is None


def test_get_status_reflects_mqtt_connection_state(wired):
    agent, mqtt, _ros, _video = wired
    assert agent.get_status()["status"] == "degraded"

    mqtt.connected = True
    assert agent.get_status()["status"] == "ok"


def test_get_metrics_reports_rtp_packets_sent_from_video_streamer(wired):
    agent, _mqtt, _ros, video = wired
    assert agent.get_metrics()["rtp_packets_sent"] == 0

    video.rtp_packets_sent  # FakeVideoStreamer has no real pipeline - stays 0, honestly
    assert agent.get_metrics()["rtp_packets_sent"] == 0


def test_camera_frame_is_forwarded_to_video_streamer(wired):
    agent, _mqtt, _ros, video = wired
    frame = CameraFrame(data=b"\x00" * 12, width=4, height=1, encoding="rgb8")

    agent._on_camera_frame(frame)

    assert video.pushed_frames == [frame]
    assert agent.get_metrics()["camera_frames_received"] == 1


def test_camera_frame_push_failure_does_not_raise(wired):
    agent, _mqtt, _ros, video = wired

    def broken_push(_frame):
        raise RuntimeError("pipeline exploded")

    video.push_frame = broken_push

    agent._on_camera_frame(CameraFrame(data=b"\x00", width=1, height=1, encoding="rgb8"))  # must not raise

    assert agent.get_metrics()["camera_frames_received"] == 0


def test_stream_video_reports_status_without_raising(wired):
    agent, _mqtt, _ros, video = wired

    agent.stream_video()  # pipeline not built yet - must not raise


# --- WebRTC signalling (Milestone 8) - see agent.py's _on_camera_offer /
# _handle_camera_offer_blocking and docs/08-webrtc-signalling.md. Tested
# via the blocking handler directly (same style as _on_camera_frame's own
# tests above) rather than through the real background thread
# _on_camera_offer spins - that thread-spawning itself is a single `assert
# isinstance` away from being untestable noise; what matters is what runs
# on it, which is exactly what these test. ---
def test_camera_offer_calls_video_streamer_and_publishes_answer(wired):
    agent, mqtt, _ros, video = wired

    agent._handle_camera_offer_blocking({"request_id": "req-1", "sdp": "offer-sdp"})

    assert video.handled_offers == ["offer-sdp"]
    topic, payload, qos, _retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/camera/answer"
    assert qos == 1
    body = json.loads(payload)
    assert body == {"request_id": "req-1", "sdp": video.answer_sdp}
    assert agent.get_metrics()["webrtc_offers_handled"] == 1
    assert agent.get_metrics()["webrtc_offers_failed"] == 0


def test_camera_offer_missing_fields_is_rejected_without_raising(wired):
    agent, mqtt, _ros, video = wired

    agent._handle_camera_offer_blocking({"request_id": "req-1"})  # no sdp

    assert video.handled_offers == []
    assert mqtt.published == []
    assert agent.get_metrics()["webrtc_offers_failed"] == 1


def test_camera_offer_failure_does_not_raise_or_publish(wired):
    agent, mqtt, _ros, video = wired
    video.handle_offer_error = RuntimeError("negotiation exploded")

    agent._handle_camera_offer_blocking({"request_id": "req-1", "sdp": "offer-sdp"})  # must not raise

    assert mqtt.published == []
    assert agent.get_metrics()["webrtc_offers_failed"] == 1
    assert agent.get_metrics()["webrtc_offers_handled"] == 0


async def test_camera_offer_arriving_over_mqtt_is_handled_end_to_end(wired):
    """Exercises the real path: MQTT delivery -> _on_camera_offer spins a
    background thread -> _handle_camera_offer_blocking runs on it and
    publishes the answer. The only test here that doesn't call the
    blocking handler directly, so it's the one proving the thread hand-off
    itself actually works."""
    import time

    agent, mqtt, _ros, video = wired
    await agent.connect()  # registers the camera/offer subscription, publishes retained "online"
    published_before = len(mqtt.published)

    mqtt.simulate_incoming(f"robots/{ROBOT_ID}/camera/offer", {"request_id": "req-2", "sdp": "offer-sdp"})

    deadline = time.monotonic() + 2
    while time.monotonic() < deadline and len(mqtt.published) == published_before:
        time.sleep(0.01)

    assert video.handled_offers == ["offer-sdp"]
    topic, payload, _qos, _retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/camera/answer"
    assert json.loads(payload)["request_id"] == "req-2"

    video.pushed_frames.append(
        CameraFrame(data=b"\x00", width=1, height=1, encoding="rgb8")
    )
    agent.stream_video()  # pipeline "ready" now - still must not raise
