"""Device-side copy of the topic contract.

This intentionally duplicates cloud/backend/app/mqtt/topics.py rather than
importing it: the device and the cloud are separately deployed artifacts
that only share a wire protocol, so a shared Python import between them
would be a lie about how they are coupled. The real system has the same
duplication for the same reason (robot-container/robot_agent/topics.py vs
cloud-container/backend/app/mqtt/topics.py).

If you change a topic name, change it in BOTH files.
"""


def string_topic(device_id: str) -> str:
    """Device -> cloud: the latest string reading."""
    return f"devices/{device_id}/string"


def int_topic(device_id: str) -> str:
    """Device -> cloud: the latest integer reading."""
    return f"devices/{device_id}/int"


def cmd_topic(device_id: str) -> str:
    """Cloud -> device: commands. Subscribed in main.py."""
    return f"devices/{device_id}/cmd"
