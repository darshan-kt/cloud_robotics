"""FastAPI application factory and entrypoint.

Milestone 7 wired in auth, the fleet manager, robot registry, session
manager, the robots REST API, the MQTT service, and the teleop/status
WebSockets. Milestone 8 adds the WebRTC signalling relay - replacing the
robot's throwaway dev_signalling_server.py with a real, MQTT-mediated
offer/answer exchange (see webrtc/relay.py and docs/08-webrtc-signalling.md).

Everything long-lived (the Postgres pool, the Redis client, the MQTT
connection) is created and torn down in `lifespan()`, then handed to the
route modules via `app.state` - see api/robots.py's get_fleet_manager()
for how a request reaches the one shared FleetManager instance.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.api.robots import router as robots_router
from app.api.webrtc import router as webrtc_router
from app.config import get_settings
from app.db.postgres import create_pool as create_postgres_pool
from app.db.redis import create_client as create_redis_client
from app.fleet.manager import FleetManager
from app.logging_config import configure_logging
from app.mqtt.service import MQTTService
from app.registry.store import RobotRegistry
from app.sessions.manager import SessionManager
from app.webrtc.relay import WebRTCSignallingRelay
from app.ws.status import router as status_ws_router
from app.ws.teleop import router as teleop_ws_router

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("backend.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    pg_pool = await create_postgres_pool(
        settings.postgres_host,
        settings.postgres_port,
        settings.postgres_db,
        settings.postgres_user,
        settings.postgres_password,
    )
    redis_client = create_redis_client(settings.redis_host, settings.redis_port)

    registry = RobotRegistry(pg_pool, redis_client)
    sessions = SessionManager(pg_pool, redis_client, settings.session_ttl_seconds)
    mqtt_service = MQTTService(
        settings.mqtt_host,
        settings.mqtt_port,
        settings.mqtt_backend_username,
        settings.mqtt_backend_password,
    )
    webrtc_relay = WebRTCSignallingRelay(mqtt_service)

    # The registry and the WebRTC relay are the only things that react to
    # inbound fleet MQTT messages - everything else (fleet manager, API,
    # WebSockets) reads whatever state the registry already recorded, or
    # calls the relay directly, never subscribes to MQTT itself. See
    # mqtt/service.py's on_message().
    mqtt_service.on_message("status", registry.record_status)
    mqtt_service.on_message("telemetry", registry.record_telemetry)
    mqtt_service.on_message("health", registry.record_health)
    mqtt_service.on_message("heartbeat", registry.record_heartbeat)
    mqtt_service.on_message("camera/answer", webrtc_relay.handle_answer)

    fleet_manager = FleetManager(registry, sessions, mqtt_service)

    app.state.pg_pool = pg_pool
    app.state.redis_client = redis_client
    app.state.mqtt_service = mqtt_service
    app.state.fleet_manager = fleet_manager
    app.state.webrtc_relay = webrtc_relay

    await mqtt_service.connect()
    logger.info("Backend fully started")

    yield

    logger.info("Backend shutting down")
    await mqtt_service.disconnect()
    await redis_client.aclose()
    await pg_pool.close()


def create_app() -> FastAPI:
    app = FastAPI(title="Cloud Robotics Backend", version="0.1.0", lifespan=lifespan)

    # Wide open for local development. There's no cookie-based session to
    # protect here - auth is a bearer token the client attaches explicitly
    # - so an open CORS policy doesn't create a CSRF hole the way it would
    # for cookie auth; still worth tightening to the real frontend
    # origin(s) once Milestone 9 fixes what those are.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(robots_router)
    app.include_router(webrtc_router)
    app.include_router(teleop_ws_router)
    app.include_router(status_ws_router)

    return app


app = create_app()
