"""JWT revocation - a server-side blacklist of `jti` claims in Redis.

A JWT is normally stateless: once issued, nothing can invalidate it before
its own `exp`. That's a real problem for a robot-teleop console specifically
- if an operator's laptop is stolen or a token leaks, "wait up to
JWT_EXPIRY_SECONDS" is not an acceptable answer. Storing revoked `jti`s in
Redis with a TTL equal to the token's own remaining lifetime fixes that
(POST /auth/logout, see api/auth.py) while self-cleaning: a revocation
entry never outlives the token it revokes, so this set can't grow
unbounded. See docs/12-security-hardening.md.
"""
import redis.asyncio as redis


def _key(jti: str) -> str:
    return f"revoked_jti:{jti}"


async def revoke(redis_client: redis.Redis, jti: str, ttl_seconds: int) -> None:
    await redis_client.set(_key(jti), "1", ex=max(ttl_seconds, 1))


async def is_revoked(redis_client: redis.Redis, jti: str) -> bool:
    return bool(await redis_client.exists(_key(jti)))
