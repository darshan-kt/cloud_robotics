"""Single source of truth for MQTT topic names.

Mirrors cloud-container/backend/app/mqtt/topics.py and
robot-container/robot_agent/topics.py — the same `devices/{id}/{kind}`
shape as the real system's `robots/{id}/{kind}`, with two kinds instead of
seven.

Both sides of the wire import from a topics module rather than writing
topic strings inline. That is the point of the file: a typo'd topic string
in one place fails silently — the publish succeeds, nobody is subscribed,
and the data simply never arrives.
"""

STRING_KIND = "string"
INT_KIND = "int"

KINDS = (STRING_KIND, INT_KIND)


def string_topic(device_id: str) -> str:
    """Device -> cloud: the latest string reading."""
    return f"devices/{device_id}/string"


def int_topic(device_id: str) -> str:
    """Device -> cloud: the latest integer reading."""
    return f"devices/{device_id}/int"


def cmd_topic(device_id: str) -> str:
    """Cloud -> device: commands.

    Nothing in this demo's UI sends one yet. It exists because the real
    system's northbound/southbound split is the thing worth copying: the
    device publishes telemetry on topics the cloud may only read, and the
    cloud publishes commands on a topic the device may only read.

    INTERN TASK (security): with an anonymous broker and no ACL, *any*
    client that can reach the broker can publish to this topic. Enforcing
    that split is the mosquitto ACL exercise.
    """
    return f"devices/{device_id}/cmd"


# Wildcard forms. The real backend subscribes fleet-wide with `+` so adding
# a robot needs no code change; same idea here even though the demo runs a
# single device.
def string_topic_wildcard() -> str:
    return "devices/+/string"


def int_topic_wildcard() -> str:
    return "devices/+/int"


def parse_topic(topic: str) -> tuple[str, str] | None:
    """`devices/demo-device-01/int` -> `("demo-device-01", "int")`.

    Returns None for anything that isn't a three-segment device topic, so a
    stray message on an unexpected topic is dropped rather than crashing the
    message handler.
    """
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "devices":
        return None
    return parts[1], parts[2]
