"""FleetManager - the one place that composes registry + sessions + MQTT
into the operations the API/WS layers actually need. Neither api/ nor ws/
talks to RobotRegistry, SessionManager, or MQTTService directly - every
request goes through here, so "what does it take to command a robot" has
exactly one implementation, used identically by the REST endpoint and the
teleop WebSocket (see docs/07-cloud-backend.md).
"""
import logging
from typing import Optional

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
    ):
        self._registry = registry
        self._sessions = sessions
        self._mqtt = mqtt
        self._logger = logger or logging.getLogger("backend.fleet")

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
        return RobotDetail(**summary.model_dump(), telemetry=telemetry, health=health)

    async def acquire_session(self, robot_id: str, operator: str) -> SessionInfo:
        await self._require_known(robot_id)
        return await self._sessions.acquire(robot_id, operator)

    async def release_session(self, robot_id: str, operator: str) -> None:
        await self._require_known(robot_id)
        await self._sessions.release(robot_id, operator)

    async def send_command(self, robot_id: str, operator: str, command: Command) -> None:
        """`stop` is a deliberate safety override: any authenticated
        operator can send it regardless of who (if anyone) currently holds
        the control session - see docs/07-cloud-backend.md. Every other
        command requires holding the session, and successfully sending one
        renews it, so a teleop operator actively driving never loses the
        lock to their own session's TTL mid-session."""
        await self._require_known(robot_id)
        if command != "stop":
            try:
                await self._sessions.require_holder(robot_id, operator)
            except SessionConflictError:
                raise
            await self._sessions.renew(robot_id, operator)
        self._mqtt.publish_command(robot_id, command)
        self._logger.info(f"{operator} -> {robot_id}: {command}")

    async def _require_known(self, robot_id: str) -> None:
        if await self._registry.get_robot(robot_id) is None:
            raise RobotNotFoundError(robot_id)
