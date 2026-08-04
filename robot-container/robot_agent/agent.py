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
import threading
import time
from typing import Optional

from robot_agent.config import AgentConfig
from robot_agent.dispatcher import CommandDispatcher
from robot_agent.interfaces import MQTTClientInterface, ROSAdapter
from robot_agent.models import BatteryState, CameraFrame, DiagnosticsData, OdometryData
from robot_agent.topics import (
    camera_answer_topic,
    camera_offer_topic,
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
        video_streamer,
        logger: Optional[logging.Logger] = None,
    ):
        self._robot_id = robot_id
        self._mqtt = mqtt_client
        self._ros = ros_adapter
        self._config = config
        self._video = video_streamer
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
            "camera_frames_received": 0,
            "webrtc_offers_handled": 0,
            "webrtc_offers_failed": 0,
        }
        self._started_at = time.monotonic()

        self._ros.subscribe_odometry(self._on_odometry)
        self._ros.subscribe_battery(self._on_battery)
        self._ros.subscribe_diagnostics(self._on_diagnostics)
        self._ros.subscribe_camera(self._on_camera_frame)

    # --- ROSAdapter callbacks: cache the latest sample for the periodic publishers ---
    def _on_odometry(self, data: OdometryData) -> None:
        self._latest_odometry = data

    def _on_battery(self, data: BatteryState) -> None:
        self._latest_battery = data

    def _on_diagnostics(self, data: DiagnosticsData) -> None:
        self._latest_diagnostics = data

    def _on_camera_frame(self, frame: CameraFrame) -> None:
        # Runs on the ROS2 callback thread (see real_ros_adapter.py) - one
        # bad frame must not take down the whole camera subscription.
        try:
            self._video.push_frame(frame)
            self._metrics["camera_frames_received"] += 1
        except Exception:
            self._logger.exception("Error pushing camera frame to VideoStreamer")

    # --- public service surface (see master spec) ---
    async def connect(self) -> None:
        self._mqtt.set_will(status_topic(self._robot_id), self._status_payload("offline"), qos=1, retain=True)
        await self._mqtt.connect()
        self._mqtt.subscribe(cmd_topic(self._robot_id), qos=1, callback=self.receive_command)
        self._mqtt.subscribe(camera_offer_topic(self._robot_id), qos=1, callback=self._on_camera_offer)
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
        """The GStreamer pipeline itself runs continuously and independently
        of any viewer (camera frames arrive and get encoded via
        _on_camera_frame regardless), and per-viewer WebRTC negotiation is
        driven by whatever signalling transport is in use (real MQTT-
        mediated signalling as of Milestone 8 - see _on_camera_offer below)
        - neither is something this method needs to kick off. What's left
        for the agent's own public surface is observability: report
        whether the pipeline is up and how much it's actually streamed, so
        this stays a meaningful exposed service rather than a no-op. See
        docs/06-video-streaming.md."""
        ready = getattr(self._video, "is_pipeline_ready", False)
        frames = getattr(self._video, "frames_pushed", 0)
        self._logger.info(f"Video pipeline ready={ready}, frames_pushed={frames}")

    # --- WebRTC signalling (Milestone 8) - MQTT-mediated, replacing
    # dev_signalling_server.py's throwaway HTTP endpoint entirely. See
    # docs/08-webrtc-signalling.md. ---
    def _on_camera_offer(self, payload: dict) -> None:
        """MQTT callback (runs on the MQTT client's own thread - see
        mqtt_client.py's _handle_message). VideoStreamer.handle_offer()
        blocks for real (it waits for ICE gathering, up to ~10s - see
        docs/06-video-streaming.md), so it must never run directly on this
        thread: that would stall every other inbound MQTT message
        (including the next cmd) for the whole negotiation. Spinning a
        dedicated thread per offer is the same "own thread for blocking
        work" shape used everywhere else in this codebase (VideoStreamer's
        own GLib thread, RealROSAdapter's spin thread)."""
        threading.Thread(
            target=self._handle_camera_offer_blocking,
            args=(payload,),
            daemon=True,
            name="webrtc-offer",
        ).start()

    def _handle_camera_offer_blocking(self, payload: dict) -> None:
        """Runs on its own thread (see _on_camera_offer) - never call this
        directly from the MQTT callback thread."""
        request_id = payload.get("request_id")
        sdp = payload.get("sdp")
        if not request_id or not sdp:
            self._logger.error(f"Malformed WebRTC offer payload: {payload}")
            self._metrics["webrtc_offers_failed"] += 1
            return
        try:
            answer_sdp = self._video.handle_offer(sdp)
        except Exception:
            self._logger.exception(f"Error handling WebRTC offer (request_id={request_id})")
            self._metrics["webrtc_offers_failed"] += 1
            return
        answer_payload = json.dumps({"request_id": request_id, "sdp": answer_sdp})
        self._mqtt.publish(camera_answer_topic(self._robot_id), answer_payload, qos=1)
        self._metrics["webrtc_offers_handled"] += 1

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
        return {
            **self._metrics,
            # Proof media is actually flowing off the video pipeline, not
            # just that camera frames went IN or that signalling succeeded -
            # those turned out to be different questions. See
            # docs/06-video-streaming.md. getattr-guarded so this stays
            # meaningful against FakeVideoStreamer in tests too.
            "rtp_packets_sent": getattr(self._video, "rtp_packets_sent", 0),
            "uptime_seconds": round(time.monotonic() - self._started_at, 1),
        }

    def _status_payload(self, status: str) -> str:
        return json.dumps({"robot_id": self._robot_id, "status": status, "timestamp": time.time()})

    def _publish_status(self, status: str) -> None:
        self._mqtt.publish(status_topic(self._robot_id), self._status_payload(status), qos=1, retain=True)
