"""POST /robots/{id}/webrtc/offer - the browser-facing half of WebRTC
signalling (Milestone 8). Deliberately does NOT require holding the
robot's control session (see fleet/manager.py) - watching video and
driving are independent concerns (docs/00-overview.md's Path 1 vs Path 2),
so an operator who's only observing shouldn't need the control lock just
to see the feed. It DOES require authentication - anonymous video access
was never part of the contract.

Since docs/security-findings.md F3 it also enforces a renegotiation rate
limit and a viewer lock (webrtc/rate_limit.py). Both exist because an
offer is destructive on the robot side: VideoStreamer builds a fresh
webrtcbin per offer and discards the previous one, so an unguarded offer
endpoint let any operator both flood the robot's GStreamer pipeline and
silently terminate whoever was already watching.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth.dependencies import get_current_operator
from app.fleet.manager import FleetManager, RobotNotFoundError
from app.models import WebRTCAnswerResponse, WebRTCOfferRequest
from app.webrtc.rate_limit import (
    OfferRateLimitError,
    VideoInUseError,
    check_offer_allowed,
    claim_viewer,
    current_viewer,
    release_viewer,
)
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
    request: Request,
    fleet: FleetManager = Depends(get_fleet_manager),
    relay: WebRTCSignallingRelay = Depends(get_webrtc_relay),
    operator: str = Depends(get_current_operator),
) -> WebRTCAnswerResponse:
    redis_client = request.app.state.redis_client

    try:
        await fleet.get_robot(robot_id)
    except RobotNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown robot '{robot_id}'")

    # Rate limit first: it must apply even to a caller who would go on to
    # be rejected by the viewer lock, otherwise the lock check itself
    # becomes the thing you can hammer.
    try:
        await check_offer_allowed(redis_client, operator, robot_id)
    except OfferRateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc))

    try:
        await claim_viewer(redis_client, operator, robot_id, takeover=body.takeover)
    except VideoInUseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))

    try:
        answer_sdp = await relay.relay_offer(robot_id, body.sdp)
    except WebRTCRelayTimeoutError as exc:
        # The robot never answered, so this operator isn't actually
        # watching anything - don't leave them holding the feed and
        # locking everyone else out for the full TTL.
        await release_viewer(redis_client, operator, robot_id)
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc))
    return WebRTCAnswerResponse(sdp=answer_sdp)


@router.get("/{robot_id}/webrtc/viewer")
async def get_current_video_viewer(
    robot_id: str,
    request: Request,
    _operator: str = Depends(get_current_operator),
) -> dict:
    """Who currently holds this robot's video feed, so the UI can say
    'held by X - take over?' instead of presenting a bare error."""
    return {"robot_id": robot_id, "viewer": await current_viewer(request.app.state.redis_client, robot_id)}


@router.delete("/{robot_id}/webrtc/viewer", status_code=status.HTTP_204_NO_CONTENT)
async def release_video_viewer(
    robot_id: str,
    request: Request,
    operator: str = Depends(get_current_operator),
) -> None:
    """Explicitly give up the feed - lets a browser closing the video panel
    free the robot immediately instead of waiting out the lock TTL."""
    await release_viewer(request.app.state.redis_client, operator, robot_id)
