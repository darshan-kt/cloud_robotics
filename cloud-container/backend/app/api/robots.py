"""GET /robots, GET /robots/{id}, POST/DELETE /robots/{id}/session,
POST /robots/{id}/control, POST /robots/{id}/stop.

Every handler here is a thin adapter: extract the operator from the JWT
(app/auth/dependencies.py), call the one FleetManager instance (stored on
`app.state` - see main.py's lifespan), and translate its exceptions into
the right HTTP status. All the actual logic - session ownership, MQTT
publish, registry lookups - lives in fleet/manager.py, exercised
identically by both this REST API and ws/teleop.py's WebSocket.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth.dependencies import get_current_operator
from app.fleet.manager import FleetManager, RobotNotFoundError
from app.models import ControlRequest, RobotDetail, RobotSummary, SessionInfo
from app.sessions.manager import SessionConflictError

router = APIRouter(prefix="/robots", tags=["robots"])


def get_fleet_manager(request: Request) -> FleetManager:
    return request.app.state.fleet_manager


@router.get("", response_model=list[RobotSummary])
async def list_robots(
    fleet: FleetManager = Depends(get_fleet_manager),
    _operator: str = Depends(get_current_operator),
) -> list[RobotSummary]:
    return await fleet.list_robots()


@router.get("/{robot_id}", response_model=RobotDetail)
async def get_robot(
    robot_id: str,
    fleet: FleetManager = Depends(get_fleet_manager),
    _operator: str = Depends(get_current_operator),
) -> RobotDetail:
    try:
        return await fleet.get_robot(robot_id)
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")


@router.post("/{robot_id}/session", response_model=SessionInfo)
async def acquire_session(
    robot_id: str,
    fleet: FleetManager = Depends(get_fleet_manager),
    operator: str = Depends(get_current_operator),
) -> SessionInfo:
    try:
        return await fleet.acquire_session(robot_id, operator)
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")
    except SessionConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))


@router.delete("/{robot_id}/session", status_code=status.HTTP_204_NO_CONTENT)
async def release_session(
    robot_id: str,
    fleet: FleetManager = Depends(get_fleet_manager),
    operator: str = Depends(get_current_operator),
) -> None:
    try:
        await fleet.release_session(robot_id, operator)
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")
    except SessionConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))


@router.post("/{robot_id}/control", status_code=status.HTTP_202_ACCEPTED)
async def send_control(
    robot_id: str,
    body: ControlRequest,
    fleet: FleetManager = Depends(get_fleet_manager),
    operator: str = Depends(get_current_operator),
) -> dict:
    try:
        await fleet.send_command(robot_id, operator, body.command)
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")
    except SessionConflictError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    return {"status": "sent"}


@router.post("/{robot_id}/stop", status_code=status.HTTP_202_ACCEPTED)
async def emergency_stop(
    robot_id: str,
    fleet: FleetManager = Depends(get_fleet_manager),
    operator: str = Depends(get_current_operator),
) -> dict:
    """Deliberately bypasses the session-ownership check FleetManager
    enforces for every other command - see fleet/manager.py's
    send_command() docstring for why `stop` is the one safety override."""
    try:
        await fleet.send_command(robot_id, operator, "stop")
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")
    return {"status": "sent"}
