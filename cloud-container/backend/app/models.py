"""Shared Pydantic models - API request/response schemas AND the shapes
passed between backend modules (registry, sessions, fleet). Pydantic here,
not plain dataclasses (contrast robot_agent/models.py on the robot side):
these cross an HTTP/WebSocket boundary and need real validation and JSON
schema generation, which robot_agent's internal-only domain types never
do.
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

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
    lidar: Optional[dict] = None


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


class WsTicketResponse(BaseModel):
    """A short-lived, single-use credential for the two WebSocket endpoints
    (/ws/status, /ws/teleop/{id}) - see auth/dependencies.py's
    get_current_operator_ws() and docs/12-security-hardening.md for why the
    long-lived operator JWT no longer travels in a WS URL query string."""

    ticket: str
    expires_in: int


class WebRTCOfferRequest(BaseModel):
    """See api/webrtc.py and docs/08-webrtc-signalling.md - `sdp` is the
    browser's own RTCPeerConnection offer text, relayed to the robot over
    MQTT, never touched or interpreted by the backend itself.

    Bounded and shape-checked since docs/security-findings.md F4. This text
    is relayed over MQTT and then handed to GStreamer's SDP parser and
    webrtcbin - C libraries, running on the least-hardened machine in the
    system. The backend deliberately does not *interpret* the SDP (that
    would break the "signalling only, never touch the media" rule), but
    refusing something that cannot possibly be a valid offer is free, and
    it stops the obvious cases from ever reaching that parser.
    """

    # A real browser offer is 2-6 KB; 64 KB is generous headroom while
    # staying well under the broker's own 256 KB message_size_limit.
    sdp: str = Field(max_length=65_536)

    # Opt-in takeover of a feed another operator currently holds. Default
    # False so taking someone's video away is always a deliberate act -
    # see webrtc/rate_limit.py's viewer lock and docs/security-findings.md F3.
    takeover: bool = False

    @field_validator("sdp")
    @classmethod
    def must_look_like_an_sdp_offer(cls, value: str) -> str:
        # RFC 4566: the version field is mandatory and must come first.
        if not value.startswith("v=0"):
            raise ValueError("not an SDP offer (must begin with 'v=0')")
        if "m=video" not in value:
            raise ValueError("SDP offer contains no video media section")
        return value


class WebRTCAnswerResponse(BaseModel):
    sdp: str
