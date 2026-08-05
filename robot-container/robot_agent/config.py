"""Configuration loader: YAML defaults with environment variable overrides.

Same explicit-precedence philosophy as cloud-container/backend/app/
config.py: environment variable > config/default.yaml > dataclass default,
applied by hand rather than through a settings-library's implicit
source-merging - the precedence is something you can read in five minutes,
not something you have to trust a library got right.
"""
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
DEFAULT_CONFIG_FILE = CONFIG_DIR / "default.yaml"


@dataclass
class MQTTConfig:
    host: str = "mosquitto"
    port: int = 1883
    keepalive: int = 30
    password: str = ""  # always required via env - see load_config()


@dataclass
class IntervalsConfig:
    heartbeat_seconds: float = 1.0
    telemetry_seconds: float = 1.0
    health_seconds: float = 2.0
    # Independent of /scan's own ROS2 publish rate (~5Hz on the real
    # simulated LDS-01) - same "cache the latest, republish on our own
    # schedule" pattern as telemetry/health. 0.5s (2Hz) is plenty for a
    # small on-screen panel; nothing downstream needs sensor-native rate.
    lidar_seconds: float = 0.5
    watchdog_check_seconds: float = 5.0
    watchdog_unhealthy_after_seconds: float = 15.0


@dataclass
class MotionConfig:
    linear_speed: float = 0.2
    angular_speed: float = 0.5


@dataclass
class HealthServerConfig:
    port: int = 8080


@dataclass
class VideoConfig:
    bitrate_kbps: int = 1000
    framerate: int = 15
    keyframe_interval: int = 30
    stun_server: str = "stun://stun.l.google.com:19302"
    # Empty by default - TURN is opt-in via TURN_SERVER_URL (see
    # docker-compose.yml's coturn service). Needed for real ICE
    # connectivity against a Chrome browser: Chrome hides its own local
    # candidates behind random mDNS ".local" hostnames by default (a
    # privacy feature, not a bug) that this project's GStreamer/libnice
    # ICE stack has no way to resolve - confirmed by direct SDP inspection
    # while verifying Milestone 9's frontend. A TURN relay candidate is a
    # real, unobfuscated address on both ends regardless of mDNS, and is
    # also exactly what a real robot behind a NAT/firewall would need in
    # an actual AWS deployment - not a dev-only workaround. See
    # docs/09-frontend.md.
    turn_server: str = ""


@dataclass
class AgentConfig:
    robot_id: str = "turtlebot3_01"
    log_level: str = "INFO"
    mqtt: MQTTConfig = field(default_factory=MQTTConfig)
    intervals: IntervalsConfig = field(default_factory=IntervalsConfig)
    motion: MotionConfig = field(default_factory=MotionConfig)
    health_server: HealthServerConfig = field(default_factory=HealthServerConfig)
    video: VideoConfig = field(default_factory=VideoConfig)


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def load_config() -> AgentConfig:
    yaml_data = _load_yaml(DEFAULT_CONFIG_FILE)
    mqtt_yaml = yaml_data.get("mqtt", {})
    intervals_yaml = yaml_data.get("intervals", {})
    motion_yaml = yaml_data.get("motion", {})
    health_yaml = yaml_data.get("health_server", {})
    video_yaml = yaml_data.get("video", {})

    mqtt_password = os.environ.get("MQTT_ROBOT_PASSWORD")
    if not mqtt_password:
        raise RuntimeError(
            "MQTT_ROBOT_PASSWORD is required (see .env.example) - the agent "
            "cannot authenticate to the broker without it"
        )

    return AgentConfig(
        robot_id=os.environ.get("ROBOT_ID", yaml_data.get("robot", {}).get("id", "turtlebot3_01")),
        log_level=os.environ.get("LOG_LEVEL", yaml_data.get("log_level", "INFO")),
        mqtt=MQTTConfig(
            host=os.environ.get("MQTT_HOST", mqtt_yaml.get("host", "mosquitto")),
            port=int(os.environ.get("MQTT_PORT", mqtt_yaml.get("port", 1883))),
            keepalive=int(mqtt_yaml.get("keepalive", 30)),
            password=mqtt_password,
        ),
        intervals=IntervalsConfig(
            heartbeat_seconds=float(intervals_yaml.get("heartbeat_seconds", 1.0)),
            telemetry_seconds=float(intervals_yaml.get("telemetry_seconds", 1.0)),
            health_seconds=float(intervals_yaml.get("health_seconds", 2.0)),
            lidar_seconds=float(intervals_yaml.get("lidar_seconds", 0.5)),
            watchdog_check_seconds=float(intervals_yaml.get("watchdog_check_seconds", 5.0)),
            watchdog_unhealthy_after_seconds=float(
                intervals_yaml.get("watchdog_unhealthy_after_seconds", 15.0)
            ),
        ),
        motion=MotionConfig(
            linear_speed=float(motion_yaml.get("linear_speed", 0.2)),
            angular_speed=float(motion_yaml.get("angular_speed", 0.5)),
        ),
        health_server=HealthServerConfig(
            port=int(os.environ.get("ROBOT_HEALTH_PORT", health_yaml.get("port", 8080))),
        ),
        video=VideoConfig(
            bitrate_kbps=int(video_yaml.get("bitrate_kbps", 1000)),
            framerate=int(video_yaml.get("framerate", 15)),
            keyframe_interval=int(video_yaml.get("keyframe_interval", 30)),
            stun_server=video_yaml.get("stun_server", "stun://stun.l.google.com:19302"),
            turn_server=os.environ.get("TURN_SERVER_URL", video_yaml.get("turn_server", "")),
        ),
    )
