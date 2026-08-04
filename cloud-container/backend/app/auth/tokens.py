"""JWT issuance and validation - pure functions, no FastAPI dependency, so
they're unit-testable without spinning up the app (see
cloud-container/tests/test_auth.py).

Exactly one operator identity exists right now (see app/config.py's
operator_username/operator_password) - this module doesn't know or care
about that; it just encodes/decodes a `sub` (subject) claim. Swapping in
real multi-operator accounts later (a users table, hashed passwords) only
touches auth/service.py's authenticate(), never this file.
"""
import time
from typing import Optional

import jwt


def create_access_token(subject: str, secret: str, algorithm: str, expiry_seconds: int) -> str:
    now = int(time.time())
    payload = {"sub": subject, "iat": now, "exp": now + expiry_seconds}
    return jwt.encode(payload, secret, algorithm=algorithm)


def decode_access_token(token: str, secret: str, algorithm: str) -> Optional[str]:
    """Returns the subject (operator username) if the token is valid and
    unexpired, or None otherwise - callers turn None into a 401, see
    auth/dependencies.py."""
    try:
        payload = jwt.decode(token, secret, algorithms=[algorithm])
    except jwt.PyJWTError:
        return None
    return payload.get("sub")
