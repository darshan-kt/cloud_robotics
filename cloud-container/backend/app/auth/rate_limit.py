"""Redis-backed brute-force protection for POST /auth/login.

The platform has exactly one shared operator credential (see
auth/service.py) - brute force against it is the entire attack surface a
login endpoint has to defend. A fixed-window failure counter plus a
lockout key is enough here: this isn't rate-limiting traffic across
millions of distinct accounts, it's stopping an attacker from trying
passwords against the one account that exists, so simplicity beats a
fancier sliding-window/exponential-backoff scheme. See
docs/12-security-hardening.md.
"""
import redis.asyncio as redis

_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 300
_LOCKOUT_SECONDS = 300


def _attempts_key(client_ip: str) -> str:
    return f"login_attempts:{client_ip}"


def _lockout_key(client_ip: str) -> str:
    return f"login_lockout:{client_ip}"


async def seconds_locked_out(redis_client: redis.Redis, client_ip: str) -> int:
    """Returns seconds remaining in an active lockout, or 0 if not locked."""
    ttl = await redis_client.ttl(_lockout_key(client_ip))
    return ttl if ttl and ttl > 0 else 0


async def record_failure(redis_client: redis.Redis, client_ip: str) -> None:
    key = _attempts_key(client_ip)
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, _WINDOW_SECONDS)
    if count >= _MAX_ATTEMPTS:
        await redis_client.set(_lockout_key(client_ip), "1", ex=_LOCKOUT_SECONDS)
        await redis_client.delete(key)


async def record_success(redis_client: redis.Redis, client_ip: str) -> None:
    await redis_client.delete(_attempts_key(client_ip), _lockout_key(client_ip))
