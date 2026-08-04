"""Unit tests for fleet/manager.py's orchestration logic - fake
registry/sessions/MQTT, no live Postgres/Redis/broker needed. This is
where the actual business rules live (session ownership, the `stop`
safety override), so it's the highest-value place for fast tests - see
cloud-container/tests/README.md.
"""
import pytest

from app.fleet.manager import FleetManager, RobotNotFoundError
from app.sessions.manager import SessionConflictError
from fake_mqtt_service import FakeMQTTService
from fake_registry import FakeRobotRegistry
from fake_session_manager import FakeSessionManager

ROBOT_ID = "turtlebot3_01"
OPERATOR = "alice"
OTHER_OPERATOR = "bob"


@pytest.fixture
def wired():
    registry = FakeRobotRegistry()
    registry.add_robot(ROBOT_ID)
    sessions = FakeSessionManager()
    mqtt = FakeMQTTService()
    fleet = FleetManager(registry, sessions, mqtt)
    return fleet, registry, sessions, mqtt


async def test_list_robots_reports_in_use_by_from_sessions(wired):
    fleet, _registry, sessions, _mqtt = wired
    sessions.holders[ROBOT_ID] = OPERATOR

    robots = await fleet.list_robots()

    assert robots[0].in_use_by == OPERATOR


async def test_get_robot_raises_for_unknown_robot(wired):
    fleet, _registry, _sessions, _mqtt = wired

    with pytest.raises(RobotNotFoundError):
        await fleet.get_robot("no-such-robot")


async def test_acquire_session_raises_for_unknown_robot(wired):
    fleet, _registry, _sessions, _mqtt = wired

    with pytest.raises(RobotNotFoundError):
        await fleet.acquire_session("no-such-robot", OPERATOR)


async def test_send_command_requires_holding_the_session(wired):
    fleet, _registry, _sessions, mqtt = wired

    with pytest.raises(SessionConflictError):
        await fleet.send_command(ROBOT_ID, OPERATOR, "forward")

    assert mqtt.published == []


async def test_send_command_succeeds_once_session_is_held(wired):
    fleet, _registry, sessions, mqtt = wired
    await sessions.acquire(ROBOT_ID, OPERATOR)

    await fleet.send_command(ROBOT_ID, OPERATOR, "forward")

    assert mqtt.published == [(ROBOT_ID, "forward")]


async def test_send_command_rejects_a_non_holder_even_if_someone_else_holds_it(wired):
    fleet, _registry, sessions, mqtt = wired
    await sessions.acquire(ROBOT_ID, OTHER_OPERATOR)

    with pytest.raises(SessionConflictError):
        await fleet.send_command(ROBOT_ID, OPERATOR, "forward")

    assert mqtt.published == []


async def test_stop_bypasses_the_session_requirement(wired):
    """The one safety override - see fleet/manager.py's send_command()
    docstring: any authenticated operator can stop a robot regardless of
    who (if anyone) holds the control session."""
    fleet, _registry, _sessions, mqtt = wired

    await fleet.send_command(ROBOT_ID, OPERATOR, "stop")

    assert mqtt.published == [(ROBOT_ID, "stop")]


async def test_stop_works_even_when_someone_else_holds_the_session(wired):
    fleet, _registry, sessions, mqtt = wired
    await sessions.acquire(ROBOT_ID, OTHER_OPERATOR)

    await fleet.send_command(ROBOT_ID, OPERATOR, "stop")

    assert mqtt.published == [(ROBOT_ID, "stop")]
    # Stop doesn't evict the existing holder - it's a safety override on
    # the COMMAND, not a session takeover.
    assert sessions.holders[ROBOT_ID] == OTHER_OPERATOR


async def test_release_session_rejects_a_non_holder(wired):
    fleet, _registry, sessions, _mqtt = wired
    await sessions.acquire(ROBOT_ID, OTHER_OPERATOR)

    with pytest.raises(SessionConflictError):
        await fleet.release_session(ROBOT_ID, OPERATOR)
