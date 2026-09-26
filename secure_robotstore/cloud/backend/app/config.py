"""Settings, from environment variables only.

The real backend (cloud-container/backend/app/config.py) layers YAML
defaults under env overrides. This demo drops the YAML layer on purpose —
one source, no precedence rules to explain — but keeps the same shape so
the step up to the real thing is recognisable.

INTERN TASK (security): nothing here is validated or guarded. The real
config module has an `assert_production_safe()` that refuses to start when
ENVIRONMENT=production is paired with dev credentials, a wildcard CORS
origin, or a default signing secret. There is no such guard here.
"""
import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    log_level: str = "INFO"

    # INTERN TASK (security): "*" lets any origin on the internet call this
    # API from a browser. The real backend takes a comma-separated allowlist.
    cors_allowed_origins: str = "*"

    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    # INTERN TASK (security): the broker here is anonymous — no username, no
    # password, no ACL, no TLS. See mosquitto/mosquitto.conf.

    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "robotstore"
    postgres_user: str = "robotstore"
    postgres_password: str = "robotstore"

    redis_host: str = "redis"
    redis_port: int = 6379

    # The single device this demo talks to. The real system is a fleet and
    # subscribes with an MQTT `+` wildcard across every robot; one device
    # keeps the topic map readable here.
    device_id: str = "demo-device-01"

    # How many readings of each kind to keep in the Redis ring buffer that
    # backs a new WebSocket client's initial backfill.
    history_size: int = 50


@lru_cache
def get_settings() -> Settings:
    return Settings(
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        cors_allowed_origins=os.getenv("CORS_ALLOWED_ORIGINS", "*"),
        mqtt_host=os.getenv("MQTT_HOST", "mosquitto"),
        mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
        postgres_host=os.getenv("POSTGRES_HOST", "postgres"),
        postgres_port=int(os.getenv("POSTGRES_PORT", "5432")),
        postgres_db=os.getenv("POSTGRES_DB", "robotstore"),
        postgres_user=os.getenv("POSTGRES_USER", "robotstore"),
        postgres_password=os.getenv("POSTGRES_PASSWORD", "robotstore"),
        redis_host=os.getenv("REDIS_HOST", "redis"),
        redis_port=int(os.getenv("REDIS_PORT", "6379")),
        device_id=os.getenv("DEVICE_ID", "demo-device-01"),
        history_size=int(os.getenv("HISTORY_SIZE", "50")),
    )
