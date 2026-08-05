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


def lidar_topic(robot_id: str) -> str:
    """Robot -> backend: the latest 2D LIDAR scan, republished at
    intervals.lidar_seconds (independent of /scan's own ROS2 rate - see
    agent.py's publish_lidar_scan()). See docs/api-reference.md."""
    return f"robots/{robot_id}/lidar"


def camera_offer_topic(robot_id: str) -> str:
    """Backend -> robot: an SDP offer to answer. See
    docs/08-webrtc-signalling.md - this replaces dev_signalling_server.py's
    throwaway HTTP POST /offer with the real, MQTT-mediated equivalent."""
    return f"robots/{robot_id}/camera/offer"


def camera_answer_topic(robot_id: str) -> str:
    """Robot -> backend: the SDP answer VideoStreamer.handle_offer()
    produced. See docs/08-webrtc-signalling.md."""
    return f"robots/{robot_id}/camera/answer"
