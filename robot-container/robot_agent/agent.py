"""RobotCloudAgent - the composed service exposing the public surface the
platform spec names: connect, disconnect, publishTelemetry, receiveCommand,
publishHealth, streamVideo, shutdown, restart, heartbeat (Python
snake_case for the spec's camelCase names - see docs/04-robot-agent.md).

Owns four concurrent async loops (heartbeat, telemetry, health, watchdog)
but keeps individual publish/dispatch operations synchronous - see
docs/04-robot-agent.md for why that split, rather than "everything async".
"""
import asyncio
import json
import logging
import time
from typing import Optional

from robot_agent.config import AgentConfig
from robot_agent.dispatcher import CommandDispatcher
from robot_agent.interfaces import MQTTClientInterface, ROSAdapter
from robot_agent.models import BatteryState, DiagnosticsData, OdometryData
from robot_agent.topics import (
    cmd_topic,
    health_topic,
    heartbeat_topic,
    status_topic,
    telemetry_topic,
)
from robot_agent.watchdog import Watchdog


class RobotCloudAgent:
    def __init__(
        self,
        robot_id: str,
        mqtt_client: MQTTClientInterface,
        ros_adapter: ROSAdapter,
        config: AgentConfig,
        logger: Optional[logging.Logger] = None,
    ):
        self._robot_id = robot_id
        self._mqtt = mqtt_client
        self._ros = ros_adapter
        self._config = config
        self._logger = logger or logging.getLogger("robot_agent.agent")

        self._dispatcher = CommandDispatcher(
            ros_adapter,
            config.motion.linear_speed,
            config.motion.angular_speed,
            logger=self._logger,
        )
        self._watchdog = Watchdog(
            is_connected=lambda: self._mqtt.is_connected,
            on_unhealthy=self.restart,
            check_interval_seconds=config.intervals.watchdog_check_seconds,
            unhealthy_after_seconds=config.intervals.watchdog_unhealthy_after_seconds,
            logger=self._logger,
        )

        self._latest_odometry: Optional[OdometryData] = None
        self._latest_battery: Optional[BatteryState] = None
        self._latest_diagnostics: Optional[DiagnosticsData] = None

        self._metrics = {
            "heartbeats_sent": 0,
            "telemetry_published": 0,
            "health_published": 0,
            "commands_received": 0,
            "commands_rejected": 0,
        }
        self._started_at = time.monotonic()

        self._ros.subscribe_odometry(self._on_odometry)
        self._ros.subscribe_battery(self._on_battery)
        self._ros.subscribe_diagnostics(self._on_diagnostics)

    # --- ROSAdapter callbacks: cache the latest sample for the periodic publishers ---
    def _on_odometry(self, data: OdometryData) -> None:
        self._latest_odometry = data

    def _on_battery(self, data: BatteryState) -> None:
        self._latest_battery = data

    def _on_diagnostics(self, data: DiagnosticsData) -> None:
        self._latest_diagnostics = data

    # --- public service surface (see master spec) ---
    async def connect(self) -> None:
        self._mqtt.set_will(status_topic(self._robot_id), self._status_payload("offline"), qos=1, retain=True)
        await self._mqtt.connect()
        self._mqtt.subscribe(cmd_topic(self._robot_id), qos=1, callback=self.receive_command)
        self._publish_status("online")
        self._logger.info(f"Robot Cloud Agent connected for '{self._robot_id}'")

    async def disconnect(self) -> None:
        self._publish_status("offline")
        await self._mqtt.disconnect()

    async def shutdown(self) -> None:
        self._logger.info("Shutting down Robot Cloud Agent")
        await self.disconnect()

    async def restart(self) -> None:
        self._logger.warning("Restarting MQTT connection")
        try:
            await self._mqtt.disconnect()
        except Exception:
            self._logger.exception("Error during disconnect while restarting")
        await self.connect()

    def heartbeat(self) -> None:
        payload = json.dumps({"robot_id": self._robot_id, "timestamp": time.time(), "status": "alive"})
        self._mqtt.publish(heartbeat_topic(self._robot_id), payload, qos=0)
        self._metrics["heartbeats_sent"] += 1

    def publish_telemetry(self) -> None:
        odom = self._latest_odometry
        battery = self._latest_battery
        payload = json.dumps(
            {
                "robot_id": self._robot_id,
                "timestamp": time.time(),
                "velocity": {
                    "linear": odom.linear_velocity if odom else 0.0,
                    "angular": odom.angular_velocity if odom else 0.0,
                },
                "position": {
                    "x": odom.position_x if odom else 0.0,
                    "y": odom.position_y if odom else 0.0,
                    "heading": odom.heading if odom else 0.0,
                },
                "battery_percentage": battery.percentage if battery else None,
            }
        )
        self._mqtt.publish(telemetry_topic(self._robot_id), payload, qos=0)
        self._metrics["telemetry_published"] += 1

    def publish_health(self) -> None:
        diag = self._latest_diagnostics
        payload = json.dumps(
            {
                "robot_id": self._robot_id,
                "timestamp": time.time(),
                "cpu_percent": diag.cpu_percent if diag else None,
                "memory_percent": diag.memory_percent if diag else None,
                "temperature_c": diag.temperature_c if diag else None,
                "mqtt_connected": self._mqtt.is_connected,
            }
        )
        self._mqtt.publish(health_topic(self._robot_id), payload, qos=1)
        self._metrics["health_published"] += 1

    def receive_command(self, payload: dict) -> None:
        command = payload.get("command") if isinstance(payload, dict) else None
        if not command:
            self._logger.error(f"Malformed command payload: {payload}")
            self._metrics["commands_rejected"] += 1
            return
        self._metrics["commands_received"] += 1
        if not self._dispatcher.dispatch(command):
            self._metrics["commands_rejected"] += 1

    def stream_video(self) -> None:
        self._logger.info(
            "stream_video() called but not implemented - the GStreamer/WebRTC "
            "video pipeline arrives in Milestone 6"
        )

    # --- lifecycle: the four concurrent loops ---
    async def run(self, stop_event: asyncio.Event) -> None:
        await asyncio.gather(
            self._loop(self.heartbeat, self._config.intervals.heartbeat_seconds, stop_event),
            self._loop(self.publish_telemetry, self._config.intervals.telemetry_seconds, stop_event),
            self._loop(self.publish_health, self._config.intervals.health_seconds, stop_event),
            self._watchdog.run(stop_event),
        )

    async def _loop(self, fn, interval: float, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                fn()
            except Exception:
                self._logger.exception(f"Unhandled error in periodic task {fn.__name__}")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass

    # --- introspection for the local health server (see health_server.py) ---
    def get_status(self) -> dict:
        return {
            "status": "ok" if self._mqtt.is_connected else "degraded",
            "robot_id": self._robot_id,
            "mqtt_connected": self._mqtt.is_connected,
            "uptime_seconds": round(time.monotonic() - self._started_at, 1),
        }

    def get_metrics(self) -> dict:
        return {**self._metrics, "uptime_seconds": round(time.monotonic() - self._started_at, 1)}

    def _status_payload(self, status: str) -> str:
        return json.dumps({"robot_id": self._robot_id, "status": status, "timestamp": time.time()})

    def _publish_status(self, status: str) -> None:
        self._mqtt.publish(status_topic(self._robot_id), self._status_payload(status), qos=1, retain=True)
