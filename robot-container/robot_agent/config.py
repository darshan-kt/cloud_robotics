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

    # --- TLS (docs/security-findings.md F6) ---
    # Off by default so the local Docker-network setup keeps working
    # unchanged. These exist so enabling transport security is a DEPLOYMENT
    # change, not a code change - which is the "config over hardcoding"
    # principle docs/11-aws-migration.md audits and depends on, and which
    # this one dimension previously violated.
    #
    # certfile/keyfile are the per-device client certificate. They are
    # unused today (the broker authenticates by username/password) but are
    # the same knobs the per-device x509 work needs - see
    # docs/target-architecture.md D3 - so wiring them now means that
    # migration touches deployment config rather than this file again.
    tls_enabled: bool = False
    tls_ca_certs: str = ""
    tls_certfile: str = ""
    tls_keyfile: str = ""
    # Escape hatch for a self-signed broker cert during bring-up. Logged
    # loudly when on, because it disables the check that makes TLS worth
    # having.
    tls_insecure: bool = False


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
    # Bearer token guarding /metrics and /status - see health_server.py and
    # docs/security-findings.md F1. Empty (the default) leaves them open,
    # which keeps local dev zero-config; a robot on a real network must set
    # ROBOT_HEALTH_TOKEN because its /metrics payload carries robot_id,
    # which is also its MQTT username.
    auth_token: str = ""


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


def _env_bool(name: str, default: bool) -> bool:
    """Env vars are strings; "false"/"0"/"" must not read as True. Kept
    explicit rather than relying on bool(str), which is True for any
    non-empty string including "false"."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


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
            tls_enabled=_env_bool("MQTT_TLS_ENABLED", bool(mqtt_yaml.get("tls_enabled", False))),
            tls_ca_certs=os.environ.get("MQTT_TLS_CA_CERTS", mqtt_yaml.get("tls_ca_certs", "")),
            tls_certfile=os.environ.get("MQTT_TLS_CERTFILE", mqtt_yaml.get("tls_certfile", "")),
            tls_keyfile=os.environ.get("MQTT_TLS_KEYFILE", mqtt_yaml.get("tls_keyfile", "")),
            tls_insecure=_env_bool("MQTT_TLS_INSECURE", bool(mqtt_yaml.get("tls_insecure", False))),
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
            # Env-only, never from YAML: this is a secret, and the YAML file
            # is committed. Same reasoning as mqtt_password above.
            auth_token=os.environ.get("ROBOT_HEALTH_TOKEN", ""),
        ),
        video=VideoConfig(
            bitrate_kbps=int(video_yaml.get("bitrate_kbps", 1000)),
            framerate=int(video_yaml.get("framerate", 15)),
            keyframe_interval=int(video_yaml.get("keyframe_interval", 30)),
            stun_server=video_yaml.get("stun_server", "stun://stun.l.google.com:19302"),
            turn_server=os.environ.get("TURN_SERVER_URL", video_yaml.get("turn_server", "")),
        ),
    )


# Known dev-default credentials the robot must not carry into production.
_INSECURE_ROBOT_DEFAULTS = {
    "robot_dev_password",
}


def assert_production_safe(config: AgentConfig) -> None:
    """Robot-side counterpart to the backend's own guard
    (cloud-container/backend/app/config.py). Same reasoning, same lever:
    ENVIRONMENT=production is the one thing a real deployment already sets
    differently, so it is where a refusal can live without costing local
    dev anything.

    The robot needs its own check because it is a separate process with a
    separate config - the backend refusing to boot says nothing about what
    a robot on a campus network is doing. See docs/security-findings.md.
    """
    if os.environ.get("ENVIRONMENT", "development") != "production":
        return

    failures = []
    if config.mqtt.password in _INSECURE_ROBOT_DEFAULTS:
        failures.append(
            "MQTT_ROBOT_PASSWORD still holds its development default "
            "(generate a real one with scripts/generate-secrets.sh)"
        )
    if not config.health_server.auth_token:
        failures.append(
            "ROBOT_HEALTH_TOKEN is unset, leaving /metrics and /status open - "
            "they expose robot_id, which is also this robot's MQTT username "
            "(see docs/security-findings.md F1)"
        )
    if not config.mqtt.tls_enabled:
        failures.append(
            "MQTT_TLS_ENABLED is off - credentials and telemetry would cross the "
            "network in plaintext (see docs/security-findings.md F6)"
        )
    if config.mqtt.tls_insecure:
        failures.append(
            "MQTT_TLS_INSECURE is on, which disables broker certificate verification"
        )

    if failures:
        raise RuntimeError(
            "Refusing to start with ENVIRONMENT=production:\n  - " + "\n  - ".join(failures)
        )
