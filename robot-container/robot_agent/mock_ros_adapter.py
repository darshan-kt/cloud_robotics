"""The ROSAdapter implementation that actually runs today. Zero ROS2
dependency - synthesizes plausible telemetry on a background timer so the
rest of the agent (dispatcher, telemetry publisher, health publisher) can
be built and run for real before Milestone 5 exists.

main.py injects this today; Milestone 5 swaps in ros_ws/'s real adapter
with a one-line change - nothing here or in agent.py needs to know that
happened. See docs/04-robot-agent.md.
"""
import logging
import math
import threading
from typing import Callable, Optional

from robot_agent.interfaces import ROSAdapter
from robot_agent.models import BatteryState, DiagnosticsData, OdometryData


class MockROSAdapter(ROSAdapter):
    def __init__(
        self,
        robot_id: str,
        update_interval_seconds: float = 1.0,
        logger: Optional[logging.Logger] = None,
    ):
        self._robot_id = robot_id
        self._update_interval = update_interval_seconds
        self._logger = logger or logging.getLogger("robot_agent.mock_ros_adapter")

        self._odometry_callback: Optional[Callable[[OdometryData], None]] = None
        self._diagnostics_callback: Optional[Callable[[DiagnosticsData], None]] = None
        self._battery_callback: Optional[Callable[[BatteryState], None]] = None

        self._linear = 0.0
        self._angular = 0.0
        self._x = 0.0
        self._y = 0.0
        self._heading = 0.0
        self._battery_percentage = 100.0

        # Constructors only wire state - starting the background timer is an
        # explicit start(), called by main.py, not a constructor side effect.
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="mock-ros-adapter")

    def start(self) -> None:
        self._thread.start()
        self._logger.info(f"MockROSAdapter started (tick every {self._update_interval}s)")

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2)

    # --- ROSAdapter ---
    def publish_cmd_vel(self, linear: float, angular: float) -> None:
        self._logger.info(f"[mock] cmd_vel linear={linear:.2f} angular={angular:.2f}")
        self._linear = linear
        self._angular = angular

    def subscribe_camera(self, callback: Callable[[bytes], None]) -> None:
        self._logger.info(
            "[mock] subscribe_camera() registered but not producing frames - "
            "the camera/GStreamer/WebRTC pipeline arrives in Milestone 6"
        )

    def subscribe_odometry(self, callback: Callable[[OdometryData], None]) -> None:
        self._odometry_callback = callback

    def subscribe_diagnostics(self, callback: Callable[[DiagnosticsData], None]) -> None:
        self._diagnostics_callback = callback

    def subscribe_battery(self, callback: Callable[[BatteryState], None]) -> None:
        self._battery_callback = callback

    # --- synthetic data generation ---
    def _run(self) -> None:
        while not self._stop_event.is_set():
            self._tick()
            self._stop_event.wait(self._update_interval)

    def _tick(self) -> None:
        dt = self._update_interval
        self._heading = (self._heading + self._angular * dt) % (2 * math.pi)
        self._x += self._linear * math.cos(self._heading) * dt
        self._y += self._linear * math.sin(self._heading) * dt

        if self._odometry_callback:
            self._odometry_callback(
                OdometryData(
                    linear_velocity=self._linear,
                    angular_velocity=self._angular,
                    position_x=self._x,
                    position_y=self._y,
                    heading=self._heading,
                )
            )

        # Battery drains slowly while moving, holds steady while idle -
        # plausible enough to exercise the telemetry/health pipeline without
        # pretending to be a real discharge model.
        if abs(self._linear) > 0 or abs(self._angular) > 0:
            self._battery_percentage = max(0.0, self._battery_percentage - 0.01)
        if self._battery_callback:
            self._battery_callback(
                BatteryState(
                    percentage=round(self._battery_percentage, 2),
                    voltage=round(10.1 + (self._battery_percentage / 100.0) * 2.0, 2),
                    is_charging=False,
                )
            )

        if self._diagnostics_callback:
            self._diagnostics_callback(
                DiagnosticsData(cpu_percent=12.5, memory_percent=34.0, temperature_c=42.0)
            )
