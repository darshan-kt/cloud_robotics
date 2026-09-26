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

    # "development" preserves the zero-config `docker compose up` experience
    # every other default here is built around. Set to "production" to turn
    # on assert_production_safe()'s hard startup guard below - see
    # docs/12-security-hardening.md.
    environment: str = "development"

    # Comma-separated list of browser origins allowed to call this API.
    # Was previously CORSMiddleware(allow_origins=["*"]) - fine for local
    # dev, not something you want load-bearing indefinitely since a bearer
    # token is readable by whatever origin can get a request through.
    cors_allowed_origins: str = "http://localhost:3000"

    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    # The backend's own MQTT identity (see cloud-container/mosquitto/aclfile)
    # - readwrite on robots/+/cmd, read-only on everything else. Never
    # granted write on telemetry/health/status - see docs/03-mqtt-layer.md
    # for why that boundary is enforced by the broker, not just convention.
    mqtt_backend_username: str = "backend"
    mqtt_backend_password: str = "backend_dev_password"
    # --- MQTT TLS (docs/security-findings.md F6) ---
    # Off by default: the backend reaches the broker over the internal
    # Docker network today. Present so enabling transport security is a
    # deployment change rather than a code change - and so the AWS IoT Core
    # migration (which is TLS-only, with client certificates) is a config
    # swap. See docs/11-aws-migration.md and target-architecture.md D3.
    mqtt_tls_enabled: bool = False
    mqtt_tls_ca_certs: str = ""
    mqtt_tls_certfile: str = ""
    mqtt_tls_keyfile: str = ""
    mqtt_tls_insecure: bool = False

    redis_host: str = "redis"
    redis_port: int = 6379
    # Required since Milestone 12 - Redis previously had no password and
    # was reachable straight from the host, a full bypass of the JWT/
    # session layer for anyone who could reach the port. See
    # docs/12-security-hardening.md.
    redis_password: str = "redis_dev_password_change_me"

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
    # Lowered from 3600: a stolen token now lives for at most 30 minutes,
    # and can be revoked immediately via POST /auth/logout regardless - see
    # docs/12-security-hardening.md.
    jwt_expiry_seconds: int = 1800

    # --- sessions/ (Milestone 7): exclusive robot-control locks ---
    # How long an operator's exclusive control session survives with no
    # renewal (a teleop command or a WS ping) before Redis expires the key
    # automatically and another operator can acquire it - the session-layer
    # equivalent of the robot's own MQTT Last-Will-and-Testament: a clean
    # release is immediate, an unclean one (browser tab closed, network
    # drop) is bounded by this TTL instead of hanging forever. See
    # docs/07-cloud-backend.md.
    session_ttl_seconds: int = 30

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


# Every (field, dev-default-value) pair that must NOT still be the shipped
# default once environment == "production" - see assert_production_safe().
_INSECURE_DEFAULTS = {
    "jwt_secret": "dev-only-insecure-secret-change-me",
    "operator_password": "operator_dev_password",
    "mqtt_backend_password": "backend_dev_password",
    "postgres_password": "robotics_dev_password",
    "redis_password": "redis_dev_password_change_me",
}


def _unsafe_production_settings(settings: "Settings") -> list[str]:
    """Settings that are dangerous in production regardless of whether they
    still hold a *default* value - a separate category from
    _INSECURE_DEFAULTS, because these are wrong even when deliberately set.
    """
    problems: list[str] = []
    if settings.mqtt_tls_insecure:
        problems.append(
            "mqtt_tls_insecure is on, which disables broker certificate/hostname "
            "verification and removes most of the value of enabling TLS at all"
        )
    if not settings.mqtt_tls_enabled:
        problems.append(
            "mqtt_tls_enabled is off - MQTT credentials and telemetry would cross "
            "the network in plaintext (see docs/security-findings.md F6)"
        )
    if any("localhost" in origin or "127.0.0.1" in origin for origin in settings.cors_origins_list):
        problems.append(
            f"cors_allowed_origins still includes a localhost origin ({settings.cors_allowed_origins}) - "
            "set it to the real console origin(s)"
        )
    return problems


def assert_production_safe(settings: "Settings") -> None:
    """Refuses to boot rather than silently ship a known dev credential or
    an unsafe transport setting.

    Every project milestone before this one shipped an "intentionally
    obvious" default (see jwt_secret's own comment) with a comment telling a
    human to change it - a comment is not a control. This makes it one:
    flipping ENVIRONMENT=production is the one thing a real deployment must
    already do differently from local dev, so it's the one lever this check
    can safely hang off without breaking `docker compose up`'s zero-config
    promise for everyone still doing local dev. See docs/12-security-hardening.md.

    Two distinct categories are checked, because they fail for different
    reasons: credentials that were never changed, and settings that are
    unsafe even when set on purpose.
    """
    if settings.environment != "production":
        return

    failures: list[str] = []

    stale = [field for field, default in _INSECURE_DEFAULTS.items() if getattr(settings, field) == default]
    if stale:
        failures.append(
            f"these still hold their insecure development defaults: {', '.join(stale)} "
            "(generate real values with scripts/generate-secrets.sh)"
        )

    failures.extend(_unsafe_production_settings(settings))

    if failures:
        raise RuntimeError(
            "Refusing to start with ENVIRONMENT=production:\n  - " + "\n  - ".join(failures)
        )


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
