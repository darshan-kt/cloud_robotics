"""POST /auth/login, POST /auth/logout, POST /auth/ws-ticket.

/auth/login is the only unauthenticated endpoint besides /health. Everything
else (robots/, /ws/teleop, /ws/status) requires either the bearer token this
issues, or (for the two WebSockets) a short-lived ticket minted from one via
/auth/ws-ticket - see app/auth/dependencies.py.
"""
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.audit.logger import record_safe
from app.auth.dependencies import get_current_operator
from app.auth.rate_limit import record_failure, record_success, seconds_locked_out
from app.auth.revocation import revoke
from app.auth.service import authenticate
from app.auth.tokens import create_access_token, decode_token_claims
from app.config import Settings, get_settings
from app.models import LoginRequest, TokenResponse, WsTicketResponse

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer_scheme = HTTPBearer(auto_error=False)

# Single-use WS tickets carry the operator's identity for a very short
# window - see docs/12-security-hardening.md. 15s is generous for "fetch a
# ticket, then immediately open the WebSocket" while being useless to
# anyone who captures it a moment later out of a log.
_WS_TICKET_TTL_SECONDS = 15


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, settings: Settings = Depends(get_settings)) -> TokenResponse:
    redis_client = request.app.state.redis_client
    pg_pool = request.app.state.pg_pool
    client_ip = _client_ip(request)

    locked_for = await seconds_locked_out(redis_client, client_ip)
    if locked_for:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed login attempts - try again in {locked_for}s",
            headers={"Retry-After": str(locked_for)},
        )

    if not authenticate(body.username, body.password, settings):
        await record_failure(redis_client, client_ip)
        await record_safe(pg_pool, actor=body.username, action="login", result="failure", detail={"client_ip": client_ip})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    await record_success(redis_client, client_ip)
    token = create_access_token(body.username, settings.jwt_secret, settings.jwt_algorithm, settings.jwt_expiry_seconds)
    await record_safe(pg_pool, actor=body.username, action="login", result="success", detail={"client_ip": client_ip})
    return TokenResponse(access_token=token, expires_in=settings.jwt_expiry_seconds)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> None:
    """Revokes the presented token immediately (auth/revocation.py) rather
    than letting it silently ride out its remaining lifetime - see
    docs/12-security-hardening.md for why this didn't exist before."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    claims = decode_token_claims(credentials.credentials, settings.jwt_secret, settings.jwt_algorithm)
    if claims is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    remaining = max(int(claims["exp"] - time.time()), 1)
    await revoke(request.app.state.redis_client, claims["jti"], remaining)
    await record_safe(request.app.state.pg_pool, actor=claims["sub"], action="logout", result="success")


@router.post("/ws-ticket", response_model=WsTicketResponse)
async def issue_ws_ticket(request: Request, operator: str = Depends(get_current_operator)) -> WsTicketResponse:
    """Mints a single-use, 15-second ticket for the caller's already-proven
    identity, spent by auth/dependencies.py's get_current_operator_ws() the
    moment a WebSocket connects. See that module's docstring."""
    ticket = secrets.token_urlsafe(32)
    await request.app.state.redis_client.set(f"ws_ticket:{ticket}", operator, ex=_WS_TICKET_TTL_SECONDS)
    return WsTicketResponse(ticket=ticket, expires_in=_WS_TICKET_TTL_SECONDS)
