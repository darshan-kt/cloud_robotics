"""Rate limiting and viewer arbitration for WebRTC negotiation
(docs/security-findings.md F3).

Two distinct protections that both stem from the same robot-side fact: the
VideoStreamer builds a **brand-new webrtcbin for every offer, discarding
the previous one** (video_streamer.py's _prepare_fresh_webrtcbin - a
deliberate, correct fix for a real reconnect bug, see
docs/06-video-streaming.md). That makes an offer a destructive operation on
whoever is currently watching, which nothing previously accounted for:

1. **Rate limit** - unbounded offers let one client rebuild the robot's
   GStreamer pipeline in a loop. That is a CPU denial of service against
   the least powerful machine in the system, and it repeatedly exercises
   the pad-unlinking race that Milestone 11's LiDAR work narrowed but
   validated only to 16 reconnects. Five renegotiations a minute is far
   above real use (a healthy session negotiates once) and far below what
   is needed to disrupt anything.

2. **Viewer lock** - without it, any operator requesting video silently
   kills whoever is already watching. In a classroom that means a student
   can black out the instructor's feed by opening the robot page. The lock
   makes the takeover explicit rather than accidental; it deliberately
   does NOT try to prevent takeover outright, because "the instructor
   needs to take the feed back" is a real and legitimate case.

The same operator re-offering is always allowed and refreshes the lock -
that is the ordinary reconnect path (see useWebRTCVideo.ts), not a
takeover.
"""
import redis.asyncio as redis

_MAX_OFFERS_PER_WINDOW = 5
_RATE_WINDOW_SECONDS = 60

# Generous: a viewer holds the feed for as long as they keep watching, but
# nothing renews this except a fresh offer, so it must outlive a normal
# viewing session rather than expiring mid-watch. Five minutes means an
# abandoned session frees the robot reasonably promptly without a
# heartbeat mechanism this milestone doesn't otherwise need.
_VIEWER_LOCK_SECONDS = 300


class OfferRateLimitError(Exception):
    """Too many renegotiations from one operator for one robot."""


class VideoInUseError(Exception):
    """A different operator currently holds this robot's video feed."""

    def __init__(self, holder: str, robot_id: str):
        self.holder = holder
        super().__init__(
            f"{robot_id}'s video feed is currently held by '{holder}'. "
            "Retry with takeover=true to take it over (this will end their stream)."
        )


def _rate_key(operator: str, robot_id: str) -> str:
    return f"webrtcrate:{operator}:{robot_id}"


def _viewer_key(robot_id: str) -> str:
    return f"videoviewer:{robot_id}"


async def check_offer_allowed(redis_client: redis.Redis, operator: str, robot_id: str) -> None:
    key = _rate_key(operator, robot_id)
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, _RATE_WINDOW_SECONDS)
    if count > _MAX_OFFERS_PER_WINDOW:
        raise OfferRateLimitError(
            f"{operator} exceeded {_MAX_OFFERS_PER_WINDOW} video renegotiations "
            f"per {_RATE_WINDOW_SECONDS}s for {robot_id}"
        )


async def claim_viewer(redis_client: redis.Redis, operator: str, robot_id: str, takeover: bool = False) -> None:
    """Claims (or refreshes) the video feed for `operator`.

    Raises VideoInUseError if someone else holds it and `takeover` is
    False. Refreshing your own claim is always allowed - that is a
    reconnect, not a takeover.
    """
    key = _viewer_key(robot_id)
    holder = await redis_client.get(key)
    if holder is not None and holder != operator and not takeover:
        raise VideoInUseError(holder, robot_id)
    await redis_client.set(key, operator, ex=_VIEWER_LOCK_SECONDS)


async def release_viewer(redis_client: redis.Redis, operator: str, robot_id: str) -> None:
    """Releases the claim only if this operator still holds it, so a late
    release from a superseded viewer can't free the current one's feed."""
    key = _viewer_key(robot_id)
    holder = await redis_client.get(key)
    if holder == operator:
        await redis_client.delete(key)


async def current_viewer(redis_client: redis.Redis, robot_id: str) -> str | None:
    return await redis_client.get(_viewer_key(robot_id))
