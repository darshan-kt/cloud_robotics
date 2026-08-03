"""Minimal ROSAdapter test double that just records publish_cmd_vel() calls
- used where a test needs a ROSAdapter but isn't exercising the mock's
synthetic-data generation (see mock_ros_adapter.py for that)."""
from robot_agent.interfaces import ROSAdapter


class RecordingROSAdapter(ROSAdapter):
    def __init__(self):
        self.calls: list[tuple[float, float]] = []

    def publish_cmd_vel(self, linear, angular):
        self.calls.append((linear, angular))

    def subscribe_camera(self, callback):
        pass

    def subscribe_odometry(self, callback):
        pass

    def subscribe_diagnostics(self, callback):
        pass

    def subscribe_battery(self, callback):
        pass
