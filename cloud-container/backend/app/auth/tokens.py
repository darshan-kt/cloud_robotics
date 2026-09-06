"""JWT issuance and validation - pure functions, no FastAPI dependency, so
they're unit-testable without spinning up the app (see
cloud-container/tests/test_auth.py).

Exactly one operator identity exists right now (see app/config.py's
operator_username/operator_password) - this module doesn't know or care
about that; it just encodes/decodes a `sub` (subject) claim. Swapping in
real multi-operator accounts later (a users table, hashed passwords) only
touches auth/service.py's authenticate(), never this file.

Every token also carries a `jti` (JWT ID) claim since Milestone 12 - a
random, unique-per-token identifier that exists for exactly one reason:
a JWT is otherwise stateless and can't be invalidated before its natural
expiry, so `jti` is the handle auth/revocation.py's Redis blacklist keys
on when an operator logs out. See docs/12-security-hardening.md.
"""
import secrets
import time
from typing import Optional

import jwt


def create_access_token(subject: str, secret: str, algorithm: str, expiry_seconds: int) -> str:
    now = int(time.time())
    payload = {"sub": subject, "iat": now, "exp": now + expiry_seconds, "jti": secrets.token_hex(16)}
    return jwt.encode(payload, secret, algorithm=algorithm)


def decode_token_claims(token: str, secret: str, algorithm: str) -> Optional[dict]:
    """Returns the full claim set (sub/iat/exp/jti) if the token is valid
    and unexpired, or None otherwise. Callers that also need revocation
    checking (auth/dependencies.py) use this rather than
    decode_access_token(), since that needs the `jti`."""
    try:
        return jwt.decode(token, secret, algorithms=[algorithm])
    except jwt.PyJWTError:
        return None


def decode_access_token(token: str, secret: str, algorithm: str) -> Optional[str]:
    """Returns just the subject (operator username), or None - kept for
    callers (and tests) that only ever needed identity, not revocation
    status. See decode_token_claims() for the full claim set."""
    claims = decode_token_claims(token, secret, algorithm)
    return claims.get("sub") if claims else None
