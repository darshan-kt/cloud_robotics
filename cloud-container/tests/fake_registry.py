"""In-memory RobotRegistry test double - no Postgres/Redis needed. Mirrors
robot-container/tests/fake_ros_adapter.py's role: lets FleetManager's own
orchestration logic be tested in isolation from the stores it composes."""
from typing import Optional

from app.models import RobotSummary


class FakeRobotRegistry:
    def __init__(self):
        self.robots: dict[str, RobotSummary] = {}
        self.telemetry: dict[str, dict] = {}
        self.health: dict[str, dict] = {}

    def add_robot(self, robot_id: str, **overrides) -> None:
        defaults = {"robot_id": robot_id, "display_name": robot_id, "status": "online"}
        self.robots[robot_id] = RobotSummary(**{**defaults, **overrides})

    async def list_robots(self) -> list[RobotSummary]:
        return [r.model_copy() for r in self.robots.values()]

    async def get_robot(self, robot_id: str) -> Optional[RobotSummary]:
        robot = self.robots.get(robot_id)
        return robot.model_copy() if robot else None

    async def get_telemetry(self, robot_id: str) -> Optional[dict]:
        return self.telemetry.get(robot_id)

    async def get_health(self, robot_id: str) -> Optional[dict]:
        return self.health.get(robot_id)
