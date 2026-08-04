"""Unit tests for auth/tokens.py and auth/service.py - pure functions, no
live Postgres/Redis/MQTT needed, so these run on every commit (see
cloud-container/tests/README.md's unit-vs-integration split).
"""
import time

import jwt
import pytest

from app.auth.service import authenticate
from app.auth.tokens import create_access_token, decode_access_token
from app.config import Settings

SECRET = "test-secret"
ALGORITHM = "HS256"


def test_create_and_decode_round_trips_the_subject():
    token = create_access_token("operator", SECRET, ALGORITHM, expiry_seconds=3600)

    assert decode_access_token(token, SECRET, ALGORITHM) == "operator"


def test_decode_rejects_wrong_secret():
    token = create_access_token("operator", SECRET, ALGORITHM, expiry_seconds=3600)

    assert decode_access_token(token, "a-different-secret", ALGORITHM) is None


def test_decode_rejects_expired_token():
    # Hand-crafted rather than sleeping past a real expiry - fast and exact.
    payload = {"sub": "operator", "iat": int(time.time()) - 100, "exp": int(time.time()) - 1}
    expired_token = jwt.encode(payload, SECRET, algorithm=ALGORITHM)

    assert decode_access_token(expired_token, SECRET, ALGORITHM) is None


def test_decode_rejects_garbage():
    assert decode_access_token("not-a-jwt-at-all", SECRET, ALGORITHM) is None


@pytest.fixture
def settings():
    return Settings(operator_username="operator", operator_password="correct-horse-battery-staple")


def test_authenticate_accepts_correct_credentials(settings):
    assert authenticate("operator", "correct-horse-battery-staple", settings) is True


def test_authenticate_rejects_wrong_password(settings):
    assert authenticate("operator", "wrong", settings) is False


def test_authenticate_rejects_wrong_username(settings):
    assert authenticate("someone-else", "correct-horse-battery-staple", settings) is False
