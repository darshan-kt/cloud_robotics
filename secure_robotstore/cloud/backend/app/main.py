"""FastAPI application factory.

Same structure as the real backend (cloud-container/backend/app/main.py):
everything long-lived — the Postgres pool, the Redis client, the MQTT
connection — is created and torn down in `lifespan()`, then hung on
`app.state` so route modules reach the one shared instance instead of
making their own.

The whole data path, in the order it is wired below:

    robot-agent ──MQTT──► mosquitto ──MQTT──► MQTTService
                                                  │
                                            ReadingStore
                                          ┌───────┼────────┐
                                       Redis  Postgres   Hub
                                                          │
                                       /ws/string_api, /ws/int_api
                                                          │
                                                       browser
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.data import router as data_router
from app.api.health import router as health_router
from app.config import get_settings
from app.db.postgres import create_pool
from app.db.redis import create_client
from app.mqtt.service import MQTTService
from app.mqtt.topics import INT_KIND, STRING_KIND
from app.store import Hub, ReadingStore
from app.ws.stream import router as stream_router

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
)
logger = logging.getLogger("backend.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    pg_pool = await create_pool(
        settings.postgres_host,
        settings.postgres_port,
        settings.postgres_db,
        settings.postgres_user,
        settings.postgres_password,
    )
    redis_client = create_client(settings.redis_host, settings.redis_port)

    hub = Hub()
    store = ReadingStore(pg_pool, redis_client, hub, settings.history_size)
    mqtt_service = MQTTService(settings.mqtt_host, settings.mqtt_port)

    # ReadingStore is the ONLY thing subscribed to inbound MQTT. Everything
    # else reads the state it recorded. Adding a second subscriber here is
    # usually a sign that logic belongs inside the store instead.
    mqtt_service.on_message(STRING_KIND, store.record)
    mqtt_service.on_message(INT_KIND, store.record)

    app.state.settings = settings
    app.state.pg_pool = pg_pool
    app.state.redis_client = redis_client
    app.state.mqtt_service = mqtt_service
    app.state.hub = hub
    app.state.store = store

    # Handlers are registered above, before connect() — so no message can
    # arrive before there is something to receive it.
    await mqtt_service.connect()
    logger.info("backend started")

    yield

    await mqtt_service.disconnect()
    await redis_client.aclose()
    await pg_pool.close()
    logger.info("backend stopped")


app = FastAPI(title="secure_robotstore backend", version="0.1.0", lifespan=lifespan)

# INTERN TASK (security): allow_origins=["*"] with allow_credentials=True is
# rejected by browsers, and "*" alone means any site a user visits can call
# this API with their session. Replace with an explicit allowlist read from
# CORS_ALLOWED_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allowed_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# INTERN TASK (security): no security headers middleware at all. The real
# backend has app/security_headers.py (HSTS, nosniff, frame-deny, CSP).

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(data_router)
app.include_router(stream_router)
