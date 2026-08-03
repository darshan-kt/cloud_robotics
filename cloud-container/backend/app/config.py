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

    redis_host: str = "redis"
    redis_port: int = 6379

    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "cloud_robotics"
    postgres_user: str = "robotics"
    postgres_password: str = "robotics_dev_password"

    backend_port: int = 8000


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
