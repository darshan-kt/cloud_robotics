"""WS /ws/teleop/{robot_id} - the low-latency, interactive counterpart to
POST /robots/{id}/control (see api/robots.py). Both call the exact same
FleetManager.send_command(), so "what does it take to command a robot" has
one implementation regardless of transport - see docs/07-cloud-backend.md.

Session lifecycle is fully owned by this connection, mirroring the
robot-side MQTT Last-Will-and-Testament pattern (docs/03-mqtt-layer.md)
deliberately: connecting ACQUIRES the control session (self-sufficient -
no separate REST call needed first), every command RENEWS it, and a clean
disconnect RELEASES it immediately. An unclean disconnect (network drop,
tab killed without a close frame) skips the `finally` release and instead
is caught by the session's own Redis TTL expiring - clean path is
immediate, unclean path is bounded, exactly like the robot's own
online/offline story.
"""
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status

from app.auth.dependencies import get_current_operator_ws
from app.fleet.manager import FleetManager, RobotNotFoundError
from app.models import Command
from app.sessions.manager import SessionConflictError

router = APIRouter()
logger = logging.getLogger("backend.ws.teleop")

_VALID_COMMANDS = set(Command.__args__)  # type: ignore[attr-defined]


@router.websocket("/ws/teleop/{robot_id}")
async def teleop(websocket: WebSocket, robot_id: str, operator: str = Depends(get_current_operator_ws)) -> None:
    fleet: FleetManager = websocket.app.state.fleet_manager
    await websocket.accept()

    try:
        await fleet.acquire_session(robot_id, operator)
    except RobotNotFoundError:
        await websocket.send_json({"error": f"unknown robot '{robot_id}'"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except SessionConflictError as exc:
        await websocket.send_json({"error": str(exc)})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    logger.info(f"{operator} started teleop session on {robot_id}")
    await websocket.send_json({"status": "session_acquired", "robot_id": robot_id})

    try:
        while True:
            data = await websocket.receive_json()
            command = data.get("command")
            if command not in _VALID_COMMANDS:
                await websocket.send_json({"error": f"invalid command '{command}'"})
                continue
            try:
                await fleet.send_command(robot_id, operator, command)
                await websocket.send_json({"status": "sent", "command": command})
            except SessionConflictError as exc:
                # Session TTL expired mid-conversation (an unusually long
                # gap between commands) - tell the client so it can
                # re-acquire rather than silently doing nothing.
                await websocket.send_json({"error": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await fleet.release_session(robot_id, operator)
            logger.info(f"{operator} ended teleop session on {robot_id}")
        except Exception:
            logger.exception(f"Error releasing session for {robot_id} on disconnect")
