"""POST /auth/login - the only unauthenticated endpoint besides /health.
Everything else (robots/, /ws/teleop, /ws/status) requires the bearer
token this issues - see app/auth/dependencies.py.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.service import authenticate
from app.auth.tokens import create_access_token
from app.config import Settings, get_settings
from app.models import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, settings: Settings = Depends(get_settings)) -> TokenResponse:
    if not authenticate(body.username, body.password, settings):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = create_access_token(
        body.username, settings.jwt_secret, settings.jwt_algorithm, settings.jwt_expiry_seconds
    )
    return TokenResponse(access_token=token, expires_in=settings.jwt_expiry_seconds)
