"""POST /robots/{id}/webrtc/offer - the browser-facing half of WebRTC
signalling (Milestone 8). Deliberately does NOT require holding the
robot's control session (see fleet/manager.py) - watching video and
driving are independent concerns (docs/00-overview.md's Path 1 vs Path 2),
so an operator who's only observing shouldn't need the control lock just
to see the feed. It DOES require authentication - anonymous video access
was never part of the contract.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth.dependencies import get_current_operator
from app.fleet.manager import FleetManager, RobotNotFoundError
from app.models import WebRTCAnswerResponse, WebRTCOfferRequest
from app.webrtc.relay import WebRTCRelayTimeoutError, WebRTCSignallingRelay

router = APIRouter(prefix="/robots", tags=["webrtc"])


def get_webrtc_relay(request: Request) -> WebRTCSignallingRelay:
    return request.app.state.webrtc_relay


def get_fleet_manager(request: Request) -> FleetManager:
    return request.app.state.fleet_manager


@router.post("/{robot_id}/webrtc/offer", response_model=WebRTCAnswerResponse)
async def relay_webrtc_offer(
    robot_id: str,
    body: WebRTCOfferRequest,
    fleet: FleetManager = Depends(get_fleet_manager),
    relay: WebRTCSignallingRelay = Depends(get_webrtc_relay),
    _operator: str = Depends(get_current_operator),
) -> WebRTCAnswerResponse:
    try:
        await fleet.get_robot(robot_id)
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")

    try:
        answer_sdp = await relay.relay_offer(robot_id, body.sdp)
    except WebRTCRelayTimeoutError as exc:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc))
    return WebRTCAnswerResponse(sdp=answer_sdp)
