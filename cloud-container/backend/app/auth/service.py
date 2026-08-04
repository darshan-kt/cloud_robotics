"""Operator authentication - checked against the single configured
operator credential (app/config.py), the same "one shared dev credential
from env, no separate provisioning system yet" shape as this project's
MQTT backend/robot credentials (see docs/03-mqtt-layer.md). Real
per-operator accounts (a users table, hashed passwords, roles) are a
natural extension of this one function, not a redesign - see
docs/07-cloud-backend.md.
"""
import hmac

from app.config import Settings


def authenticate(username: str, password: str, settings: Settings) -> bool:
    """Constant-time comparison (hmac.compare_digest) against both fields -
    a naive `==` here would leak how many leading characters matched
    through response-timing differences. Comparing both username and
    password this way means a wrong username can't be distinguished from a
    wrong password by timing alone either."""
    username_ok = hmac.compare_digest(username, settings.operator_username)
    password_ok = hmac.compare_digest(password, settings.operator_password)
    return username_ok and password_ok
