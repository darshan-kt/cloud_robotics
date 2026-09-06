"""Response security headers - this API had none before Milestone 12.

A pure ASGI-JSON API doesn't render HTML itself, but the browser still
enforces these against whatever origin serves the response (error pages,
misconfigured proxies, a future endpoint that returns something
renderable) - defense in depth costs nothing here, so there's no reason to
skip it. See docs/12-security-hardening.md.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # This API's own responses carry no useful cache value, and
        # /auth/login's response is a bearer token - never let a proxy or
        # the browser's own disk cache retain it.
        if request.url.path.startswith("/auth"):
            response.headers["Cache-Control"] = "no-store"
        return response
