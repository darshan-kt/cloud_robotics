"""Configuration loader: YAML defaults with environment variable overrides.

Precedence, highest first: environment variable > config/default.yaml > field
default. Environment variables always win because they are how deployment-
specific values (a docker-compose service name today, a real AWS endpoint
tomorrow) reach the app - the YAML file and the code never change between
environments, only the environment variables do.
"""
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
DEFAULT_CONFIG_FILE = CONFIG_DIR / "default.yaml"


class Settings(BaseModel):
    log_level: str = "INFO"

    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    # The backend's own MQTT identity (see cloud-container/mosquitto/aclfile)
    # - readwrite on robots/+/cmd, read-only on everything else. Never
    # granted write on telemetry/health/status - see docs/03-mqtt-layer.md
    # for why that boundary is enforced by the broker, not just convention.
    mqtt_backend_username: str = "backend"
    mqtt_backend_password: str = "backend_dev_password"

    redis_host: str = "redis"
    redis_port: int = 6379

    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "cloud_robotics"
    postgres_user: str = "robotics"
    postgres_password: str = "robotics_dev_password"

    backend_port: int = 8000

    # --- auth/ (Milestone 7): JWT-based operator sessions ---
    # Exactly one operator credential, from env - the same "one shared
    # dev credential, real per-identity auth is a later concern" shape as
    # MQTT's own backend/robot credentials (see docs/03-mqtt-layer.md).
    # AWS migration story: this becomes Cognito, same as MQTT's becomes
    # IoT Core certificates - see docs/00-overview.md's migration table.
    operator_username: str = "operator"
    operator_password: str = "operator_dev_password"
    # HS256 shared secret. The dev default is intentionally obvious so
    # nobody mistakes it for something safe to ship - see docs/07-cloud-backend.md.
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expiry_seconds: int = 3600

    # --- sessions/ (Milestone 7): exclusive robot-control locks ---
    # How long an operator's exclusive control session survives with no
    # renewal (a teleop command or a WS ping) before Redis expires the key
    # automatically and another operator can acquire it - the session-layer
    # equivalent of the robot's own MQTT Last-Will-and-Testament: a clean
    # release is immediate, an unclean one (browser tab closed, network
    # drop) is bounded by this TTL instead of hanging forever. See
    # docs/07-cloud-backend.md.
    session_ttl_seconds: int = 30


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def _load_env_overrides(field_names: set[str]) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    for field in field_names:
        env_value = os.environ.get(field.upper())
        if env_value is not None:
            overrides[field] = env_value
    return overrides


@lru_cache
def get_settings() -> Settings:
    yaml_values = _load_yaml(DEFAULT_CONFIG_FILE)
    env_values = _load_env_overrides(set(Settings.model_fields.keys()))
    merged = {**yaml_values, **env_values}
    return Settings(**merged)
