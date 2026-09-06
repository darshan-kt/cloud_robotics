"""Backstop rate limit on the command channel (Milestone 12).

The React frontend already throttles teleop input client-side to 20
commands/sec while a key is held (see docs/09-frontend.md) - but that's a
UX throttle enforced by a client this backend doesn't control. Nothing
stops a compromised browser tab, a replayed token, or a non-browser client
speaking the same REST/WS API from flooding `robots/{id}/cmd` at whatever
rate it likes. This is the server-side floor: a fixed window counter per
(operator, robot_id), capped well above the legitimate client rate so it
never interferes with normal teleop, only a genuine flood.
"""
import redis.asyncio as redis

_WINDOW_SECONDS = 1
_MAX_COMMANDS_PER_WINDOW = 40  # 2x the frontend's own 20/s throttle


class CommandRateLimitError(Exception):
    """Raised when an operator exceeds the backstop command rate for a robot."""


def _key(operator: str, robot_id: str) -> str:
    return f"cmdrate:{operator}:{robot_id}"


async def check_and_increment(redis_client: redis.Redis, operator: str, robot_id: str) -> None:
    key = _key(operator, robot_id)
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, _WINDOW_SECONDS)
    if count > _MAX_COMMANDS_PER_WINDOW:
        raise CommandRateLimitError(f"{operator} exceeded {_MAX_COMMANDS_PER_WINDOW} commands/s to {robot_id}")
