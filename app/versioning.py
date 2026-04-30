"""API versioning middleware stub."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class VersionRoutingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        return await call_next(request)
