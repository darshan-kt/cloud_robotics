"""Login.

INTERN TASK (security) — this whole file is the exercise. Every one of the
following is deliberately wrong, and each maps to something the real
backend (cloud-container/backend/app/auth/) does properly:

  1. Credentials are a hardcoded dict in source. Real: users in Postgres.
  2. Passwords are compared in PLAINTEXT. Real: bcrypt/argon2 hashes.
  3. The comparison is `==`, which leaks timing. Real: `secrets.compare_digest`.
  4. The "token" is a base64 blob of the username with no signature and no
     expiry — anyone can mint one. Real: a signed JWT with an exp claim.
  5. Nothing validates the token afterwards. `/api/*` and `/ws/*` never check
     it; the frontend just stores it and shows the UI.
  6. No rate limit, so this endpoint can be brute-forced as fast as the
     network allows. Real: a Redis-backed attempt limiter.
  7. Failures say WHICH field was wrong, confirming valid usernames to an
     attacker. Real: one generic message for both cases.

The endpoint exists at all so the frontend has a real login screen to gate
on and a real request to make — the shape is right even though none of the
substance is.
"""
import base64
import logging

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("backend.auth")

# INTERN TASK (security): #1 and #2 above.
_USERS = {
    "operator": "demo1234",
    "viewer": "demo1234",
}


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    ok: bool
    token: str | None = None
    username: str | None = None
    error: str | None = None


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    expected = _USERS.get(body.username)

    # INTERN TASK (security): #7 — these two branches are distinguishable.
    if expected is None:
        logger.info(f"login failed: no such user {body.username!r}")
        return LoginResponse(ok=False, error="No such user.")

    # INTERN TASK (security): #3 — plain `==` on a secret.
    if expected != body.password:
        logger.info(f"login failed: wrong password for {body.username!r}")
        return LoginResponse(ok=False, error="Wrong password.")

    # INTERN TASK (security): #4 — this is not a token, it is a username in
    # a costume. Decodable and forgeable by anyone, and it never expires.
    token = base64.b64encode(f"{body.username}:demo".encode()).decode()

    logger.info(f"login ok: {body.username}")
    return LoginResponse(ok=True, token=token, username=body.username)
