import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.redis import RedisIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import time
import logging

logger = logging.getLogger(__name__)

_initialized = False


def init_sentry():
    global _initialized
    if _initialized:
        return

    from app.config import get_settings
    settings = get_settings()

    if not settings.sentry_dsn:
        logger.warning("Sentry DSN not configured — error monitoring disabled")
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            RedisIntegration(),
            SqlalchemyIntegration(),
        ],
        traces_sample_rate=0.1,
        profiles_sample_rate=0.05,
        send_default_pii=False,
    )
    _initialized = True
    logger.info(f"Sentry initialized for environment: {settings.sentry_environment}")


def is_sentry_enabled() -> bool:
    return _initialized


def capture_exception_with_context(exc, **kwargs):
    if not is_sentry_enabled():
        logger.error(f"Exception (Sentry disabled): {exc}", exc_info=exc)
        return

    with sentry_sdk.configure_scope() as scope:
        request_id = kwargs.get("request_id")
        if request_id:
            scope.set_tag("request_id", request_id)

        path = kwargs.get("path", "")
        method = kwargs.get("method", "")
        scope.set_tag("path", path)
        scope.set_tag("method", method)

        country = kwargs.get("country", "unknown")
        scope.set_tag("country", country)

        is_p0 = kwargs.get("is_p0", False)
        if is_p0:
            scope.set_level("critical")

        sentry_sdk.capture_exception(exc)


class SentrySlowQueryMiddleware(BaseHTTPMiddleware):
    SLOW_QUERY_THRESHOLD_MS = 1000

    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000

        if duration_ms > self.SLOW_QUERY_THRESHOLD_MS and is_sentry_enabled():
            sentry_sdk.add_breadcrumb(
                message=f"Slow query: {request.method} {request.url.path}",
                category="slow_query",
                level="warning",
                data={
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": round(duration_ms, 2),
                },
            )
        return response