import json

import pytest
from fake_mqtt_client import FakeMQTTClient
from fake_ros_adapter import RecordingROSAdapter

from robot_agent.agent import RobotCloudAgent
from robot_agent.config import AgentConfig
from robot_agent.models import OdometryData

ROBOT_ID = "test-robot"


@pytest.fixture
def wired():
    mqtt = FakeMQTTClient()
    ros = RecordingROSAdapter()
    config = AgentConfig()
    agent = RobotCloudAgent(robot_id=ROBOT_ID, mqtt_client=mqtt, ros_adapter=ros, config=config)
    return agent, mqtt, ros


async def test_connect_sets_will_subscribes_cmd_and_publishes_retained_online(wired):
    agent, mqtt, _ros = wired

    await agent.connect()

    assert mqtt.connect_calls == 1
    assert mqtt.will[0] == f"robots/{ROBOT_ID}/status"
    assert json.loads(mqtt.will[1])["status"] == "offline"

    assert f"robots/{ROBOT_ID}/cmd" in mqtt.subscriptions

    topic, payload, qos, retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/status"
    assert retain is True
    assert qos == 1
    assert json.loads(payload)["status"] == "online"


async def test_shutdown_publishes_offline_status_and_disconnects(wired):
    agent, mqtt, _ros = wired
    await agent.connect()

    await agent.shutdown()

    topic, payload, _qos, retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/status"
    assert retain is True
    assert json.loads(payload)["status"] == "offline"
    assert mqtt.disconnect_calls == 1


async def test_receive_command_dispatches_to_ros_adapter(wired):
    agent, mqtt, ros = wired
    await agent.connect()

    mqtt.simulate_incoming(f"robots/{ROBOT_ID}/cmd", {"command": "forward"})

    default_linear_speed = AgentConfig().motion.linear_speed
    assert ros.calls == [(default_linear_speed, 0.0)]


async def test_receive_command_rejects_malformed_payload_without_raising(wired):
    agent, mqtt, ros = wired
    await agent.connect()

    mqtt.simulate_incoming(f"robots/{ROBOT_ID}/cmd", {"not_a_command_field": True})

    assert ros.calls == []
    assert agent.get_metrics()["commands_rejected"] == 1


def test_heartbeat_publishes_to_heartbeat_topic(wired):
    agent, mqtt, _ros = wired

    agent.heartbeat()

    topic, payload, qos, retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/heartbeat"
    assert qos == 0
    assert retain is False
    assert json.loads(payload)["robot_id"] == ROBOT_ID


def test_publish_telemetry_uses_latest_cached_odometry(wired):
    agent, mqtt, _ros = wired
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
    agent, mqtt, _ros = wired

    agent.publish_telemetry()  # no odometry/battery callback has fired yet

    topic, payload, _qos, _retain = mqtt.published[-1]
    assert topic == f"robots/{ROBOT_ID}/telemetry"
    assert json.loads(payload)["battery_percentage"] is None


def test_get_status_reflects_mqtt_connection_state(wired):
    agent, mqtt, _ros = wired
    assert agent.get_status()["status"] == "degraded"

    mqtt.connected = True
    assert agent.get_status()["status"] == "ok"
