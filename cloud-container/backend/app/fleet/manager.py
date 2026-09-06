"""FleetManager - the one place that composes registry + sessions + MQTT
into the operations the API/WS layers actually need. Neither api/ nor ws/
talks to RobotRegistry, SessionManager, or MQTTService directly - every
request goes through here, so "what does it take to command a robot" has
exactly one implementation, used identically by the REST endpoint and the
teleop WebSocket (see docs/07-cloud-backend.md).

Since Milestone 12, this is also the one place that (a) enforces a
backstop rate limit on the command channel and (b) writes the
tamper-evident audit trail - both optional constructor dependencies
(`pg_pool`, `rate_limit_redis`) so the existing unit tests (fakes only, no
live Postgres/Redis) keep working unmodified: neither feature does
anything when its dependency is None. main.py's real instantiation wires
both. See docs/12-security-hardening.md.
"""
import logging
from typing import Optional

import asyncpg
import redis.asyncio as redis

from app.audit.logger import record_safe
from app.fleet.rate_limit import CommandRateLimitError, check_and_increment
from app.models import Command, RobotDetail, RobotSummary, SessionInfo
from app.mqtt.service import MQTTService
from app.registry.store import RobotRegistry
from app.sessions.manager import SessionConflictError, SessionManager


class RobotNotFoundError(Exception):
    """No robot with this id has ever been seen by the backend."""


class FleetManager:
    def __init__(
        self,
        registry: RobotRegistry,
        sessions: SessionManager,
        mqtt: MQTTService,
        logger: Optional[logging.Logger] = None,
        pg_pool: Optional[asyncpg.Pool] = None,
        rate_limit_redis: Optional[redis.Redis] = None,
    ):
        self._registry = registry
        self._sessions = sessions
        self._mqtt = mqtt
        self._logger = logger or logging.getLogger("backend.fleet")
        self._pg_pool = pg_pool
        self._rate_limit_redis = rate_limit_redis

    async def list_robots(self) -> list[RobotSummary]:
        summaries = await self._registry.list_robots()
        for summary in summaries:
            summary.in_use_by = await self._sessions.get_holder(summary.robot_id)
        return summaries

    async def get_robot(self, robot_id: str) -> RobotDetail:
        summary = await self._registry.get_robot(robot_id)
        if summary is None:
            raise RobotNotFoundError(robot_id)
        summary.in_use_by = await self._sessions.get_holder(robot_id)
        telemetry = await self._registry.get_telemetry(robot_id)
        health = await self._registry.get_health(robot_id)
        lidar = await self._registry.get_lidar_scan(robot_id)
        return RobotDetail(**summary.model_dump(), telemetry=telemetry, health=health, lidar=lidar)

    async def acquire_session(self, robot_id: str, operator: str) -> SessionInfo:
        await self._require_known(robot_id)
        try:
            info = await self._sessions.acquire(robot_id, operator)
        except SessionConflictError as exc:
            await self._audit(operator, "session_acquire", robot_id, "denied", {"reason": str(exc)})
            raise
        await self._audit(operator, "session_acquire", robot_id, "success")
        return info

    async def release_session(self, robot_id: str, operator: str) -> None:
        await self._require_known(robot_id)
        await self._sessions.release(robot_id, operator)
        await self._audit(operator, "session_release", robot_id, "success")

    async def send_command(self, robot_id: str, operator: str, command: Command) -> None:
        """`stop` is a deliberate safety override: any authenticated
        operator can send it regardless of who (if anyone) currently holds
        the control session - see docs/07-cloud-backend.md. Every other
        command requires holding the session, and successfully sending one
        renews it, so a teleop operator actively driving never loses the
        lock to their own session's TTL mid-session.

        Every command EXCEPT `stop` is also subject to a backstop rate
        limit (fleet/rate_limit.py) - a ceiling well above the frontend's
        own client-side 20/s throttle, meant to catch a compromised or
        non-browser client flooding the MQTT command topic. `stop` is
        deliberately exempt for the same reason it bypasses the session
        check above: a safety override that could itself be rate-limited
        out of delivery - e.g. by the very flood of movement commands it's
        meant to interrupt - would defeat its own purpose."""
        await self._require_known(robot_id)
        if command != "stop" and self._rate_limit_redis is not None:
            try:
                await check_and_increment(self._rate_limit_redis, operator, robot_id)
            except CommandRateLimitError:
                await self._audit(operator, "command", robot_id, "rate_limited", {"command": command})
                raise
        if command != "stop":
            try:
                await self._sessions.require_holder(robot_id, operator)
            except SessionConflictError as exc:
                await self._audit(operator, "command", robot_id, "denied", {"command": command, "reason": str(exc)})
                raise
            await self._sessions.renew(robot_id, operator)
        self._mqtt.publish_command(robot_id, command)
        self._logger.info(f"{operator} -> {robot_id}: {command}")
        await self._audit(operator, "command", robot_id, "success", {"command": command})

    async def _audit(self, operator: str, action: str, robot_id: str, result: str, detail: Optional[dict] = None) -> None:
        if self._pg_pool is not None:
            await record_safe(self._pg_pool, actor=operator, action=action, robot_id=robot_id, result=result, detail=detail)

    async def _require_known(self, robot_id: str) -> None:
        if await self._registry.get_robot(robot_id) is None:
            raise RobotNotFoundError(robot_id)
