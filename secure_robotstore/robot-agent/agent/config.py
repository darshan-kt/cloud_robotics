"""Device settings, from environment variables.

Mirrors robot-container/robot_agent/config.py, minus its YAML layer and all
of its TLS/credential fields — there are no credentials in this demo.
"""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    log_level: str = "INFO"
    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    device_id: str = "demo-device-01"
    publish_interval_seconds: float = 1.0
    health_port: int = 8080


def get_settings() -> Settings:
    return Settings(
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        mqtt_host=os.getenv("MQTT_HOST", "mosquitto"),
        mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
        device_id=os.getenv("DEVICE_ID", "demo-device-01"),
        publish_interval_seconds=float(os.getenv("PUBLISH_INTERVAL_SECONDS", "1.0")),
        health_port=int(os.getenv("HEALTH_PORT", "8080")),
    )
