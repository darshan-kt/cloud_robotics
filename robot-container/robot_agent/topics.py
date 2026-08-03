"""Single source of truth for this robot's MQTT topic names, matching the
contract documented in docs/03-mqtt-layer.md."""


def cmd_topic(robot_id: str) -> str:
    return f"robots/{robot_id}/cmd"


def telemetry_topic(robot_id: str) -> str:
    return f"robots/{robot_id}/telemetry"


def health_topic(robot_id: str) -> str:
    return f"robots/{robot_id}/health"


def status_topic(robot_id: str) -> str:
    return f"robots/{robot_id}/status"


def heartbeat_topic(robot_id: str) -> str:
    return f"robots/{robot_id}/heartbeat"
