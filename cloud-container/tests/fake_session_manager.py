"""In-memory SessionManager test double - no Postgres/Redis needed. Same
lock semantics as the real one (exactly one operator per robot) without a
TTL - tests that care about expiry exercise the real SessionManager
against live Redis instead (see test_registry_and_sessions_live.py)."""
from datetime import datetime, timezone
from typing import Optional

from app.models import SessionInfo
from app.sessions.manager import SessionConflictError


class FakeSessionManager:
    def __init__(self):
        self.holders: dict[str, str] = {}

    async def acquire(self, robot_id: str, operator: str) -> SessionInfo:
        current = self.holders.get(robot_id)
        if current is not None and current != operator:
            raise SessionConflictError(f"{robot_id} is already controlled by another operator")
        self.holders[robot_id] = operator
        now = datetime.now(timezone.utc)
        return SessionInfo(session_id="fake-session", robot_id=robot_id, operator=operator, acquired_at=now, expires_at=now)

    async def release(self, robot_id: str, operator: str) -> None:
        current = self.holders.get(robot_id)
        if current is None:
            return
        if current != operator:
            raise SessionConflictError(f"{operator} does not hold the active session for {robot_id}")
        del self.holders[robot_id]

    async def renew(self, robot_id: str, operator: str) -> None:
        await self.require_holder(robot_id, operator)

    async def get_holder(self, robot_id: str) -> Optional[str]:
        return self.holders.get(robot_id)

    async def require_holder(self, robot_id: str, operator: str) -> None:
        if self.holders.get(robot_id) != operator:
            raise SessionConflictError(f"{operator} does not hold an active control session for {robot_id}")
