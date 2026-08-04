"""WS /ws/status - fleet-wide dashboard feed. Pushes a full fleet snapshot
immediately on connect, then again every `_PUSH_INTERVAL_SECONDS` - a
periodic pull-and-push rather than a fully event-driven broadcaster wired
directly into MQTTService's message handlers. That's a deliberate,
documented scope choice for this milestone (a 2-second-old status is fine
for a fleet dashboard - it isn't the teleop control path, which is
ws/teleop.py and MQTT, not this): a real event-driven push (notify
exactly when the registry changes) is a natural enhancement, not a
correctness requirement, and would add a pub/sub subscriber registry this
milestone doesn't otherwise need. See docs/07-cloud-backend.md.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.auth.dependencies import get_current_operator_ws
from app.fleet.manager import FleetManager

router = APIRouter()
logger = logging.getLogger("backend.ws.status")

_PUSH_INTERVAL_SECONDS = 2


@router.websocket("/ws/status")
async def status_stream(websocket: WebSocket, operator: str = Depends(get_current_operator_ws)) -> None:
    fleet: FleetManager = websocket.app.state.fleet_manager
    await websocket.accept()
    logger.info(f"{operator} connected to the status stream")
    try:
        while True:
            robots = await fleet.list_robots()
            await websocket.send_json({"robots": [r.model_dump(mode="json") for r in robots]})
            await asyncio.sleep(_PUSH_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        logger.info(f"{operator} disconnected from the status stream")
