import threading
import time
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from app.models.product import ApiKey
from app.config import get_settings
from app.logging_centralized import get_logger

settings = get_settings()
logger = get_logger("api-service")


_thread_local = threading.local()


def set_request_context(request: Request):
    """Set the request context for rate limit calculation."""
    _thread_local.request = request


def get_request_context() -> Request | None:
    """Get the request from thread-local storage."""
    return getattr(_thread_local, 'request', None)


def rate_limit_from_request(request: Request = None) -> str:
    """Determine rate limit based on API key tier or fallback to IP.
    
    This function is called by slowapi with the key from key_func.
    We retrieve the request from thread-local storage set by middleware.
    """
    request = get_request_context()
    
    if request is None:
        return f"{settings.global_default_rate_limit}/minute"
    
    api_key: ApiKey | None = getattr(request.state, "api_key", None)
    is_us = _is_us_traffic(request)
    
    if api_key:
        if api_key.rate_limit is not None:
            limit = int(api_key.rate_limit)
            if is_us:
                limit = _get_us_rate_limit(limit)
            return f"{limit}/minute"
        tier = getattr(api_key, 'tier', 'basic')
        if tier == 'enterprise':
            base = 20000
        elif tier == 'pro':
            base = 5000
        elif tier == 'basic':
            base = 1000
        elif tier == 'free':
            base = 100
        else:
            base = settings.global_default_rate_limit
        if is_us:
            base = _get_us_rate_limit(base)
        return f"{base}/minute"
    
    path = request.url.path
    if '/search' in path:
        limit = settings.us_search_rate_limit if is_us else settings.global_search_rate_limit
        return f"{limit}/minute"
    elif '/products/' in path and request.method == 'GET':
        limit = settings.us_product_rate_limit if is_us else settings.global_product_rate_limit
        return f"{limit}/minute"
    elif '/watchlist' in path:
        limit = settings.us_watchlist_rate_limit if is_us else settings.global_watchlist_rate_limit
        return f"{limit}/minute"
    
    limit = settings.us_default_rate_limit if is_us else settings.global_default_rate_limit
    return f"{limit}/minute"

SEARCH_RATE_LIMIT = f"{settings.global_search_rate_limit}/minute"
PRODUCT_DETAIL_RATE_LIMIT = f"{settings.global_product_rate_limit}/minute"
WATCHLIST_RATE_LIMIT = f"{settings.global_watchlist_rate_limit}/minute"
DEFAULT_RATE_LIMIT = f"{settings.global_default_rate_limit}/minute"

US_COUNTRY_CODES = {"US", "USA"}
COUNTRY_HEADER_PATTERNS = [
    "CF-IPCountry",
    "X-Vercel-IP-Country", 
    "X-Geo-Country",
    "X-Geo-IP-Country",
]


def _get_country_from_request(request: Request) -> str:
    for header in COUNTRY_HEADER_PATTERNS:
        country = request.headers.get(header)
        if country:
            return country.upper()
    return "unknown"


def _is_us_traffic(request: Request) -> bool:
    country = _get_country_from_request(request)
    return country in US_COUNTRY_CODES


def _get_us_rate_limit(base_limit: int) -> int:
    return int(base_limit * settings.us_rate_limit_multiplier)


def get_key_identifier(request: Request) -> str:
    """Use API key id for rate limiting when available, else IP."""
    api_key: ApiKey | None = getattr(request.state, "api_key", None)
    if api_key:
        return f"key:{api_key.id}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=get_key_identifier)


def ip_rate_limit_from_request(request: Request = None) -> str:
    """Return IP-based rate limit string. Always uses IP, not API key."""
    return WATCHLIST_RATE_LIMIT


class TierRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        api_key: ApiKey | None = getattr(request.state, "api_key", None)
        
        tier = 'basic'
        rate_limit = None
        if api_key:
            tier = getattr(api_key, 'tier', 'basic')
            rate_limit = getattr(api_key, 'rate_limit', None)
        
        response = await call_next(request)
        
        if api_key:
            response.headers["X-RateLimit-Tier"] = tier
            if rate_limit:
                response.headers["X-RateLimit-Limit"] = str(rate_limit)
        
        return response


class RedisPerMinuteRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._redis = None

    async def _get_redis(self):
        if self._redis is None:
            from redis.asyncio import Redis
            from app.config import build_redis_url
            full_url = build_redis_url(settings.redis_url, settings.redis_password)
            self._redis = Redis.from_url(
                full_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        return self._redis

    async def dispatch(self, request: Request, call_next):
        import json

        path = request.url.path

        # Skip Redis for health/probe endpoints — startup probe must not block on Redis
        if path.startswith('/health') or path == '/':
            return await call_next(request)

        identifier = get_key_identifier(request)
        method = request.method
        
        # Determine key_suffix and US flag for headers and Redis key
        is_us = _is_us_traffic(request)
        is_search = '/search' in path
        is_product_detail = '/products/' in path and method == 'GET' and '{' in path
        is_watchlist = '/watchlist' in path
        
        if is_search:
            key_suffix = "search"
        elif is_product_detail:
            key_suffix = "product"
        elif is_watchlist:
            key_suffix = "watchlist"
        else:
            key_suffix = "default"
        
        # Get the limit from the rate_limit_from_request function (which includes tier and US multiplier)
        # Set the request context so the rate limit function can access it via thread-local
        set_request_context(request)
        limit_str = rate_limit_from_request(request)
        try:
            limit = int(limit_str.split('/')[0])
        except Exception:
            limit = 60
        
        # Apply burst allowance if enabled
        burst_limit = limit + settings.burst_allowance if settings.rate_limit_burst_enabled else limit
        
        try:
            redis = await self._get_redis()
            country = _get_country_from_request(request)
            rate_key = f"ratelimit:{key_suffix}:{identifier}"
            
            current = await redis.incr(rate_key)
            if current == 1:
                await redis.expire(rate_key, 60)
            
            ttl = await redis.ttl(rate_key)
            reset_time = int(time.time()) + ttl if ttl > 0 else int(time.time()) + 60
            
            remaining = max(0, burst_limit - current)
            
            response = await call_next(request)
            
            response.headers["X-RateLimit-Limit"] = str(burst_limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(reset_time)
            response.headers["X-RateLimit-Region"] = "US" if is_us else "GLOBAL"
            
            if current > burst_limit:
                logger.warning(
                    "Rate limit exceeded",
                    extra={
                        "identifier": identifier,
                        "path": path,
                        "method": method,
                        "current": current,
                        "limit": burst_limit,
                        "tier": key_suffix,
                        "country": country,
                        "is_us": is_us,
                    }
                )
                response.headers["Retry-After"] = str(ttl if ttl > 0 else 60)
            
            return response
            
        except Exception as e:
            logger.warning(
                "Rate limit middleware unavailable, failing open",
                extra={"error": str(e)}
            )
            return await call_next(request)