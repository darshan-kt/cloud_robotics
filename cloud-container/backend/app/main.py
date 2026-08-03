"""FastAPI application factory and entrypoint.

This is deliberately thin today: config + logging + a health/metrics router.
Auth, fleet manager, robot registry, session manager, the robot REST API,
the MQTT service, and WebRTC signalling are separate modules that get
wired in here starting Milestone 7 - see cloud-container/backend/README.md.
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.config import get_settings
from app.logging_config import configure_logging

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("backend.main")


def create_app() -> FastAPI:
    app = FastAPI(title="Cloud Robotics Backend", version="0.1.0")

    # Wide open for local development. Milestone 7 restricts this to the
    # real frontend origin(s) once auth/sessions exist.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)

    @app.on_event("startup")
    async def on_startup() -> None:
        logger.info("Backend starting up")
        logger.info(f"MQTT target: {settings.mqtt_host}:{settings.mqtt_port}")
        logger.info(f"Redis target: {settings.redis_host}:{settings.redis_port}")
        logger.info(
            f"Postgres target: {settings.postgres_host}:{settings.postgres_port}"
            f"/{settings.postgres_db}"
        )

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        logger.info("Backend shutting down")

    return app


app = create_app()
