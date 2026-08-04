"""FastAPI dependencies that turn a request into "the authenticated
operator's username", or reject it. Two entry points because REST and
WebSocket requests carry the token differently:

- REST: a standard `Authorization: Bearer <token>` header.
- WebSocket: browsers' native WebSocket API cannot set custom headers on
  the handshake at all, so the token travels as a `?token=` query
  parameter instead - a well-known, accepted tradeoff for browser-native
  WebSocket auth (documented here rather than silently done, since a token
  in a URL can end up in server access logs - acceptable for this
  project's dev/local scope, worth revisiting before any real deployment).
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.tokens import decode_access_token
from app.config import Settings, get_settings

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_operator(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> str:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    operator = decode_access_token(credentials.credentials, settings.jwt_secret, settings.jwt_algorithm)
    if operator is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return operator


async def get_current_operator_ws(
    websocket: WebSocket,
    token: str = Query(...),
    settings: Settings = Depends(get_settings),
) -> str:
    operator = decode_access_token(token, settings.jwt_secret, settings.jwt_algorithm)
    if operator is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return operator
