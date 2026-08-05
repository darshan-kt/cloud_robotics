"""MQTT topic helpers, matching the contract in docs/03-mqtt-layer.md and
robot_agent/topics.py on the robot side - deliberately duplicated rather
than shared as a package across the two containers (see docs/01-repository-
structure.md: robot-container and cloud-container are independently
runnable and ship on different hardware; a shared internal package would
couple their deploys together for no real benefit at this scale).

The backend's own view of the contract is fleet-wide: it subscribes with
`+` (MQTT's single-level wildcard) across every robot rather than one
robot_id at a time, so it also needs to parse a robot_id back OUT of an
inbound topic string - something the robot side never needs, since it only
ever hears about itself.
"""
import re

# robots/{robot_id}/{suffix}, where robot_id is deliberately permissive
# (Mosquitto ACL is the actual enforcement point - see aclfile) and suffix
# is everything after it - usually one segment ("status", "telemetry", ...)
# but two for WebRTC signalling ("camera/offer", "camera/answer", see
# camera_offer_topic()/camera_answer_topic_wildcard() below and
# docs/08-webrtc-signalling.md).
_TOPIC_RE = re.compile(r"^robots/([^/]+)/(.+)$")


def cmd_topic(robot_id: str) -> str:
    return f"robots/{robot_id}/cmd"


def cmd_topic_wildcard() -> str:
    return "robots/+/cmd"


def status_topic_wildcard() -> str:
    return "robots/+/status"


def telemetry_topic_wildcard() -> str:
    return "robots/+/telemetry"


def health_topic_wildcard() -> str:
    return "robots/+/health"


def heartbeat_topic_wildcard() -> str:
    return "robots/+/heartbeat"


def lidar_topic_wildcard() -> str:
    return "robots/+/lidar"


def camera_offer_topic(robot_id: str) -> str:
    """Backend -> one specific robot (not a wildcard - the backend always
    knows exactly which robot it's relaying an offer to). See
    mqtt/service.py's publish_camera_offer() and docs/08-webrtc-signalling.md."""
    return f"robots/{robot_id}/camera/offer"


def camera_answer_topic_wildcard() -> str:
    return "robots/+/camera/answer"


def parse_topic(topic: str) -> tuple[str, str] | None:
    """Splits an inbound `robots/{robot_id}/{suffix}` topic into
    (robot_id, suffix) - suffix may itself contain a `/` (e.g.
    "camera/answer") - or None if it doesn't match that shape at all
    (defensive - the backend only ever subscribes to topics of this shape,
    but a malformed/unexpected topic shouldn't crash the message handler)."""
    match = _TOPIC_RE.match(topic)
    if match is None:
        return None
    return match.group(1), match.group(2)
