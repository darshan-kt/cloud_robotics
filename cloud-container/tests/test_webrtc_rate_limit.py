"""Regression tests for the WebRTC offer rate limit and viewer lock
(docs/security-findings.md F3).

Both guards exist because an offer is DESTRUCTIVE on the robot side:
VideoStreamer builds a fresh webrtcbin per offer and discards the previous
one, so before this an unguarded offer endpoint let any operator both
flood the robot's GStreamer pipeline and silently end whoever was already
watching. These tests fail if either guard is removed.

Uses a real live Redis (same skip-if-unreachable pattern as
test_registry_and_sessions_live.py) because the guards' whole correctness
rests on Redis's own atomicity - INCR and SET/GET - which a fake would
merely reimplement, proving nothing.
"""
import os
import socket
import uuid

import pytest
import redis.asyncio as redis

from app.webrtc.rate_limit import (
    _MAX_OFFERS_PER_WINDOW,
    OfferRateLimitError,
    VideoInUseError,
    check_offer_allowed,
    claim_viewer,
    current_viewer,
    release_viewer,
)

REDIS_HOST = os.environ.get("REDIS_TEST_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_TEST_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD", "redis_dev_password_change_me")

ALICE = "alice"
BOB = "bob"


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module", autouse=True)
def _require_redis():
    if not _reachable(REDIS_HOST, REDIS_PORT):
        pytest.skip(f"Redis not reachable at {REDIS_HOST}:{REDIS_PORT} - run `docker compose up -d redis`.")


@pytest.fixture
async def client():
    c = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, password=REDIS_PASSWORD, decode_responses=True)
    yield c
    await c.aclose()


@pytest.fixture
def robot_id():
    # Unique per test so runs never collide, and no cleanup is needed
    # beyond the keys' own TTLs.
    return f"test-robot-{uuid.uuid4().hex[:8]}"


# ── Rate limit ──

async def test_offers_up_to_the_limit_are_allowed(client, robot_id):
    for _ in range(_MAX_OFFERS_PER_WINDOW):
        await check_offer_allowed(client, ALICE, robot_id)


async def test_offer_beyond_the_limit_is_rejected(client, robot_id):
    for _ in range(_MAX_OFFERS_PER_WINDOW):
        await check_offer_allowed(client, ALICE, robot_id)

    with pytest.raises(OfferRateLimitError):
        await check_offer_allowed(client, ALICE, robot_id)


async def test_rate_limit_is_scoped_per_operator(client, robot_id):
    """Alice exhausting her budget must not lock Bob out - otherwise one
    client becomes a denial of service against every other operator."""
    for _ in range(_MAX_OFFERS_PER_WINDOW):
        await check_offer_allowed(client, ALICE, robot_id)

    await check_offer_allowed(client, BOB, robot_id)


async def test_rate_limit_is_scoped_per_robot(client):
    """Watching one robot must not consume the budget for another."""
    robot_a, robot_b = f"ra-{uuid.uuid4().hex[:6]}", f"rb-{uuid.uuid4().hex[:6]}"
    for _ in range(_MAX_OFFERS_PER_WINDOW):
        await check_offer_allowed(client, ALICE, robot_a)

    await check_offer_allowed(client, ALICE, robot_b)


async def test_the_limit_is_bounded_and_sane():
    """Stops someone 'fixing' a rejection by raising the ceiling back into
    pipeline-flooding territory."""
    assert 1 <= _MAX_OFFERS_PER_WINDOW <= 30


# ── Viewer lock ──

async def test_first_viewer_claims_the_feed(client, robot_id):
    await claim_viewer(client, ALICE, robot_id)

    assert await current_viewer(client, robot_id) == ALICE


async def test_same_operator_may_renegotiate_freely(client, robot_id):
    """The ordinary reconnect path - re-offering is not a takeover."""
    await claim_viewer(client, ALICE, robot_id)
    await claim_viewer(client, ALICE, robot_id)

    assert await current_viewer(client, robot_id) == ALICE


async def test_second_operator_is_rejected_without_takeover(client, robot_id):
    """The core of F3: before this, Bob's offer silently killed Alice's
    stream with no signal to either of them."""
    await claim_viewer(client, ALICE, robot_id)

    with pytest.raises(VideoInUseError) as exc:
        await claim_viewer(client, BOB, robot_id)

    assert exc.value.holder == ALICE
    # Alice must still hold it after a rejected attempt.
    assert await current_viewer(client, robot_id) == ALICE


async def test_second_operator_succeeds_with_explicit_takeover(client, robot_id):
    """Takeover stays possible on purpose - 'the instructor needs the feed
    back' is a real case. It just has to be deliberate."""
    await claim_viewer(client, ALICE, robot_id)

    await claim_viewer(client, BOB, robot_id, takeover=True)

    assert await current_viewer(client, robot_id) == BOB


async def test_release_frees_the_feed_for_others(client, robot_id):
    await claim_viewer(client, ALICE, robot_id)
    await release_viewer(client, ALICE, robot_id)

    assert await current_viewer(client, robot_id) is None
    await claim_viewer(client, BOB, robot_id)  # no takeover needed


async def test_release_by_a_non_holder_does_not_free_the_feed(client, robot_id):
    """A late release from a superseded viewer must not hand the robot to
    whoever asks next - otherwise takeover creates a race that ends both
    streams."""
    await claim_viewer(client, ALICE, robot_id)
    await claim_viewer(client, BOB, robot_id, takeover=True)

    await release_viewer(client, ALICE, robot_id)  # Alice no longer holds it

    assert await current_viewer(client, robot_id) == BOB


async def test_no_viewer_reported_when_nobody_is_watching(client, robot_id):
    assert await current_viewer(client, robot_id) is None
