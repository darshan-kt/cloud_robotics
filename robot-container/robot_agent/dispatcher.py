"""Translates discrete MQTT commands into robot velocity commands.

The cmd topic's payload carries a command *name* (forward/backward/left/
right/stop), not a raw Twist - converting that into (linear, angular)
velocities is this module's one job, kept separate from both the MQTT layer
(which only knows JSON) and the ROSAdapter (which only knows floats). See
docs/03-mqtt-layer.md for the wire format and docs/04-robot-agent.md for
why the conversion lives here.
"""
import logging
from typing import Optional

from robot_agent.interfaces import ROSAdapter

KNOWN_COMMANDS = {"forward", "backward", "left", "right", "stop"}


class CommandDispatcher:
    def __init__(
        self,
        ros_adapter: ROSAdapter,
        linear_speed: float,
        angular_speed: float,
        logger: Optional[logging.Logger] = None,
    ):
        self._ros = ros_adapter
        self._linear_speed = linear_speed
        self._angular_speed = angular_speed
        self._logger = logger or logging.getLogger("robot_agent.dispatcher")

    def dispatch(self, command: str) -> bool:
        """Returns True if the command was recognized and dispatched."""
        if command not in KNOWN_COMMANDS:
            self._logger.error(f"Unknown command '{command}' - ignoring")
            return False

        linear, angular = self._velocities_for(command)
        self._ros.publish_cmd_vel(linear, angular)
        self._logger.info(f"Dispatched '{command}' -> linear={linear:.2f} angular={angular:.2f}")
        return True

    def _velocities_for(self, command: str) -> tuple[float, float]:
        if command == "forward":
            return self._linear_speed, 0.0
        if command == "backward":
            return -self._linear_speed, 0.0
        if command == "left":
            return 0.0, self._angular_speed
        if command == "right":
            return 0.0, -self._angular_speed
        return 0.0, 0.0  # stop
