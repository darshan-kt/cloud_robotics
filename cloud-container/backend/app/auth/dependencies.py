"""FastAPI dependencies that turn a request into "the authenticated
operator's username", or reject it. Two entry points because REST and
WebSocket requests carry the token differently:

- REST: a standard `Authorization: Bearer <token>` header, checked against
  the JWT revocation list (auth/revocation.py) so a logged-out token stops
  working immediately rather than lingering until its natural expiry.
- WebSocket: browsers' native WebSocket API cannot set custom headers on
  the handshake at all, so *something* has to travel in the URL. Since
  Milestone 12 that's no longer the operator's real JWT - a 15-second,
  single-use ticket (POST /auth/ws-ticket) travels as `?ticket=` instead.
  Even if a proxy or access log captures it, it's already spent and expired
  by the time anyone could read it back out - see docs/12-security-hardening.md
  for the token-in-URL problem this replaces.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.revocation import is_revoked
from app.auth.tokens import decode_token_claims
from app.config import Settings, get_settings

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_operator(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> str:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    claims = decode_token_claims(credentials.credentials, settings.jwt_secret, settings.jwt_algorithm)
    if claims is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if await is_revoked(request.app.state.redis_client, claims["jti"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token has been revoked")
    return claims["sub"]


async def get_current_operator_ws(
    websocket: WebSocket,
    ticket: str = Query(...),
) -> str:
    redis_client = websocket.app.state.redis_client
    operator = await redis_client.getdel(f"ws_ticket:{ticket}")
    if operator is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired ticket")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired ticket")
    return operator
