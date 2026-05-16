import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

try:
    from app.services.analytics import post_hog
except ImportError:
    post_hog = None

try:
    from app.logging_centralized import log_request as central_log_request, log_scraper_progress as central_log_scraper_progress
except ImportError:
    central_log_request = None
    central_log_scraper_progress = None

LOG_DIR = Path(os.environ.get("LOG_DIR", "/app/logs"))
LOG_FILE = LOG_DIR / "api_requests.log"
BOT_LOG_FILE = LOG_DIR / "bot_sessions.log"
MAX_BYTES = 100 * 1024 * 1024  # 100MB
BACKUP_COUNT = 5

# AI crawler / search bot patterns to track
BOT_PATTERNS: Dict[str, str] = {
    "GPTBot": "openai",
    "ChatGPT-User": "openai",
    "OAI-SearchBot": "openai",
    "ClaudeBot": "anthropic",
    "Claude-Web": "anthropic",
    "PerplexityBot": "perplexity",
    "Googlebot": "google",
    "Google-Extended": "google",
    "Bingbot": "microsoft",
    "bingbot": "microsoft",
    "DuckDuckBot": "duckduckgo",
    "Applebot": "apple",
    "Meta-ExternalAgent": "meta",
    "FacebookBot": "meta",
}


def classify_bot(user_agent: str) -> Optional[str]:
    """Return bot name if UA matches a known bot pattern, else None."""
    ua_lower = user_agent.lower()
    for token, _vendor in BOT_PATTERNS.items():
        if token.lower() in ua_lower:
            return token
    return None


def _resolve_log_dir() -> Path:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        return LOG_DIR
    except PermissionError:
        fallback_dir = Path(os.environ.get("LOG_DIR_FALLBACK", "/tmp/buywhere-logs"))
        fallback_dir.mkdir(parents=True, exist_ok=True)
        return fallback_dir


def setup_logger(name: str = "api_requests") -> logging.Logger:
    log_dir = _resolve_log_dir()
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = RotatingFileHandler(
            log_dir / "api_requests.log",
            maxBytes=MAX_BYTES,
            backupCount=BACKUP_COUNT,
        )
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    return logger


_api_logger: Optional[logging.Logger] = None
_scraper_logger: Optional[logging.Logger] = None
_bot_logger: Optional[logging.Logger] = None
_analytics_logger: Optional[logging.Logger] = None

AI_MODEL_PATTERNS = {
    "claude": ["claude", "anthropic"],
    "gpt": ["gpt", "openai", "chatgpt"],
    "gemini": ["gemini", "google"],
    "perplexity": ["perplexity"],
    "mistral": ["mistral"],
    "cohere": ["cohere"],
    "meta-llama": ["llama", "meta-llama", "meta ai"],
}

COUNTRY_HEADER_PATTERNS = [
    "CF-IPCountry",
    "X-Vercel-IP-Country",
    "X-Geo-Country",
    "X-Geo-IP-Country",
]


def _detect_ai_model(user_agent: str, x_ai_model: Optional[str]) -> Optional[str]:
    if x_ai_model:
        return x_ai_model
    ua_lower = user_agent.lower()
    for model, patterns in AI_MODEL_PATTERNS.items():
        for pattern in patterns:
            if pattern in ua_lower:
                return model
    return None


def _detect_country_from_headers(headers: dict) -> Optional[str]:
    for header in COUNTRY_HEADER_PATTERNS:
        country = headers.get(header)
        if country:
            return country.upper()
    return None


def get_logger() -> logging.Logger:
    global _api_logger
    if _api_logger is None:
        _api_logger = setup_logger("api_requests")
    return _api_logger


def get_scraper_logger() -> logging.Logger:
    global _scraper_logger
    if _scraper_logger is None:
        _scraper_logger = setup_logger("scraper_progress")
    return _scraper_logger


def get_bot_logger() -> logging.Logger:
    global _bot_logger
    if _bot_logger is None:
        log_dir = _resolve_log_dir()
        logger = logging.getLogger("bot_sessions")
        logger.setLevel(logging.INFO)
        if not logger.handlers:
            handler = RotatingFileHandler(log_dir / "bot_sessions.log", maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT)
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
        _bot_logger = logger
    return _bot_logger


def get_analytics_logger() -> logging.Logger:
    global _analytics_logger
    if _analytics_logger is None:
        log_dir = _resolve_log_dir()
        logger = logging.getLogger("api_analytics")
        logger.setLevel(logging.INFO)
        if not logger.handlers:
            handler = RotatingFileHandler(
                log_dir / "api_analytics.jsonl",
                maxBytes=MAX_BYTES,
                backupCount=BACKUP_COUNT,
            )
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
        _analytics_logger = logger
    return _analytics_logger


def _extract_keywords_from_path(path: str, query_params: dict) -> list[str]:
    keywords = []
    if path.startswith("/v1/search") or path.startswith("/v2/search"):
        q = query_params.get("q") or query_params.get("query")
        if q:
            words = q.lower().split()
            keywords.extend([w.strip() for w in words if len(w) > 2])
    if path.startswith("/v1/products") or path.startswith("/v2/products"):
        category = query_params.get("category")
        if category:
            keywords.append(category.lower())
    return keywords[:10]


def _extract_categories_from_path(path: str, query_params: dict) -> list[str]:
    categories = []
    category = query_params.get("category")
    if category:
        categories.append(category)
    return categories[:5]


def log_scraper_progress(
    scraper_name: str,
    status: str,
    items_scraped: int = 0,
    items_total: int = 0,
    error: str = None,
    duration_ms: float = None,
    **extra: Any,
) -> None:
    if central_log_scraper_progress is not None:
        central_log_scraper_progress(
            scraper_name=scraper_name,
            status=status,
            items_scraped=items_scraped,
            items_total=items_total,
            error=error,
            duration_ms=duration_ms,
            **extra,
        )
    else:
        log_entry: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "logger": "scraper",
            "scraper_name": scraper_name,
            "status": status,
            "items_scraped": items_scraped,
            "items_total": items_total,
        }
        if error:
            log_entry["error"] = error
        if duration_ms is not None:
            log_entry["duration_ms"] = round(duration_ms, 2)
        log_entry.update(extra)
        get_scraper_logger().info(json.dumps(log_entry))


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        logger = get_logger()

        start_time = time.perf_counter()
        timestamp = datetime.now(timezone.utc)

        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())

        api_key_hash = None
        api_key_id = None
        if hasattr(request.state, "api_key") and request.state.api_key:
            key_value = getattr(request.state.api_key, "key", "") or ""
            api_key_hash = hashlib.sha256(key_value.encode()).hexdigest()[:16]
            api_key_id = getattr(request.state.api_key, "id", None) or str(getattr(request.state.api_key, "key", "")[:16])

        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "")

        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        log_entry = {
            "timestamp": timestamp.isoformat(),
            "requestId": request_id,
            "method": request.method,
            "path": request.url.path,
            "statusCode": response.status_code,
            "durationMs": round(elapsed_ms, 2),
            "userAgent": user_agent,
            "apiKeyHash": api_key_hash,
            "ip": client_ip,
        }

        # Detect and log AI / search crawler bots separately
        bot_name = classify_bot(user_agent)
        if bot_name:
            log_entry["botName"] = bot_name
            get_bot_logger().info(json.dumps({
                "timestamp": timestamp.isoformat(),
                "bot": bot_name,
                "vendor": BOT_PATTERNS.get(bot_name, "unknown"),
                "path": request.url.path,
                "userAgent": user_agent,
                "ip": client_ip,
            }))

        if central_log_request is not None:
            extra = {"user_agent": user_agent, "api_key_hash": api_key_hash, "ip": client_ip}
            if bot_name:
                extra["bot_name"] = bot_name
            central_log_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=elapsed_ms,
                request_id=request_id,
                user_agent=user_agent,
                api_key_hash=api_key_hash,
                ip=client_ip,
                extra=extra,
            )
        else:
            logger.info(json.dumps(log_entry))

        # Log analytics entry for structured API analytics
        try:
            headers_dict = dict(request.headers)
            x_ai_model = headers_dict.get("x-ai-model")
            ai_model = _detect_ai_model(user_agent, x_ai_model)
            country = _detect_country_from_headers(headers_dict)
            region = None
            if country:
                if country in ("SG",):
                    region = "sg"
                elif country in ("MY", "TH", "PH", "VN", "ID"):
                    region = "sea"
                elif country in ("US",):
                    region = "us"

            mcp_tool_name = headers_dict.get("x-mcp-tool-name")

            query_params = dict(request.query_params)
            keywords = _extract_keywords_from_path(request.url.path, query_params)
            categories = _extract_categories_from_path(request.url.path, query_params)

            analytics_entry = {
                "timestamp": timestamp.isoformat(),
                "requestId": request_id,
                "apiKeyId": api_key_id,
                "method": request.method,
                "path": request.url.path,
                "statusCode": response.status_code,
                "aiModel": ai_model,
                "country": country,
                "region": region,
                "mcpToolName": mcp_tool_name,
                "keywords": keywords,
                "categories": categories,
            }
            get_analytics_logger().info(json.dumps(analytics_entry))

            # PostHog tracking for API usage (async-safe, non-blocking)
            if post_hog is not None:
                try:
                    track_properties = {
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": response.status_code,
                        "duration_ms": round(elapsed_ms, 2),
                        "ai_model": ai_model,
                        "country": country,
                        "region": region,
                        "mcp_tool_name": mcp_tool_name,
                        "keywords": keywords,
                        "categories": categories,
                        "environment": os.environ.get("ENVIRONMENT", "development"),
                    }
                    if bot_name:
                        track_properties["bot_name"] = bot_name
                        track_properties["bot_vendor"] = BOT_PATTERNS.get(bot_name, "unknown")
                        post_hog.track_event(
                            event="ai_crawler_hit",
                            properties=track_properties,
                            distinct_id=f"bot:{bot_name}",
                        )
                    elif api_key_id:
                        post_hog.track_event(
                            event="api_request",
                            properties=track_properties,
                            distinct_id=f"api_key:{api_key_id}",
                        )
                except Exception:
                    pass
        except Exception:
            pass

        return response
