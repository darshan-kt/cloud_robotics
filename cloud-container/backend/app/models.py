"""Shared Pydantic models - API request/response schemas AND the shapes
passed between backend modules (registry, sessions, fleet). Pydantic here,
not plain dataclasses (contrast robot_agent/models.py on the robot side):
these cross an HTTP/WebSocket boundary and need real validation and JSON
schema generation, which robot_agent's internal-only domain types never
do.
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

# The five commands the robot's dispatcher understands - see
# robot-container/robot_agent/dispatcher.py and docs/03-mqtt-layer.md's
# `cmd` topic contract. Kept as the single source of truth here so a typo'd
# command is a 422 at the API boundary, not a silently-rejected MQTT
# message discovered later in the robot's own logs.
Command = Literal["forward", "backward", "left", "right", "stop"]


class RobotSummary(BaseModel):
    robot_id: str
    display_name: str
    status: Literal["online", "offline", "unknown"]
    last_seen: Optional[datetime] = None
    battery_percentage: Optional[float] = None
    in_use_by: Optional[str] = None


class RobotDetail(RobotSummary):
    telemetry: Optional[dict] = None
    health: Optional[dict] = None


class ControlRequest(BaseModel):
    command: Command


class SessionInfo(BaseModel):
    session_id: str
    robot_id: str
    operator: str
    acquired_at: datetime
    expires_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class WebRTCOfferRequest(BaseModel):
    """See api/webrtc.py and docs/08-webrtc-signalling.md - `sdp` is the
    browser's own RTCPeerConnection offer text, relayed to the robot over
    MQTT, never touched or interpreted by the backend itself."""

    sdp: str


class WebRTCAnswerResponse(BaseModel):
    sdp: str
