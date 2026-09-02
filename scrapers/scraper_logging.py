"""
Centralized structured logging for BuyWhere scrapers.

Outputs JSON logs in the standardized BuyWhere format:
- service: the service identifier (e.g., "scraper-shopee_sg", "scraper-lazada_sg")
- timestamp: ISO 8601 UTC timestamp
- level: log level (DEBUG, INFO, WARN, ERROR, CRITICAL)
- message: human-readable log message
- metadata: additional contextual data including scraper-specific fields

This aligns with the logging schema defined in docs/logging-schema.md
"""

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from app.logging_centralized import get_logger as get_centralized_logger, set_trace_context
    _HAS_CENTRALIZED = True
except ImportError:
    _HAS_CENTRALIZED = False

_ERROR_TYPE_TO_LEVEL = {
    "progress": "INFO",
    "request_failed": "WARN",
    "parse_error": "ERROR",
    "ingestion_error": "ERROR",
    "page_empty": "WARN",
    "transform_error": "ERROR",
    "retry_exhausted": "ERROR",
    "network_error": "ERROR",
    "debug": "DEBUG",
}


class ScraperLoggerAdapter:
    """
    Adapter that provides StructuredLogger-style interface but routes to centralized logger.
    Translates scraper-specific method calls to centralized logger format.
    """
    def __init__(self, platform: str):
        self.platform = platform
        self._centralized = get_centralized_logger(f"scraper-{platform}") if _HAS_CENTRALIZED else None
        self._service_name = f"scraper-{platform}"

    def _log(self, level: str, message: str, extra: dict[str, Any] = None) -> None:
        if self._centralized:
            getattr(self._centralized, level.lower())(message, extra)
        else:
            entry = {
                "service": self._service_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "message": message,
            }
            if extra:
                entry["metadata"] = extra
            sys.stdout.write(json.dumps(entry, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    def progress(self, message: str) -> None:
        self._log("INFO", message)

    def request_failed(self, url: str, retry_count: int, message: str = "HTTP request failed") -> None:
        self._log("WARNING", message, {"url": url, "retry_count": retry_count, "error_type": "request_failed"})

    def parse_error(self, url: str | None, message: str = "Failed to parse response") -> None:
        self._log("ERROR", message, {"url": url, "error_type": "parse_error"})

    def ingestion_error(self, url: str | None, message: str, retry_count: int = 0) -> None:
        self._log("ERROR", message, {"url": url, "retry_count": retry_count, "error_type": "ingestion_error"})

    def page_empty(self, url: str, message: str = "Page returned no products") -> None:
        self._log("WARNING", message, {"url": url, "error_type": "page_empty"})

    def transform_error(self, url: str | None, message: str = "Failed to transform product") -> None:
        self._log("ERROR", message, {"url": url, "error_type": "transform_error"})

    def retry_exhausted(self, url: str, retry_count: int, message: str = "All retries exhausted") -> None:
        self._log("ERROR", message, {"url": url, "retry_count": retry_count, "error_type": "retry_exhausted"})

    def network_error(self, url: str, message: str) -> None:
        self._log("ERROR", message, {"url": url, "error_type": "network_error"})


class StructuredLogger:
    """
    Legacy structured logger for scrapers - outputs directly to stdout.
    Use ScraperLoggerAdapter for centralized logging integration.
    """
    def __init__(self, platform: str):
        self.platform = platform
        self._out = sys.stdout
        self._service_name = f"scraper-{platform}"

    def _log(
        self,
        error_type: str,
        message: str,
        url: str | None = None,
        retry_count: int = 0,
        details: dict[str, Any] | None = None,
    ) -> None:
        level = _ERROR_TYPE_TO_LEVEL.get(error_type, "INFO")
        metadata = details.copy() if details else {}
        if url:
            metadata["url"] = url
        if retry_count > 0:
            metadata["retry_count"] = retry_count
        metadata["scraper_name"] = self.platform
        metadata["error_type"] = error_type

        entry = {
            "service": self._service_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
        }
        if metadata:
            entry["metadata"] = metadata

        self._out.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self._out.flush()

    def request_failed(
        self, url: str, retry_count: int, message: str = "HTTP request failed"
    ) -> None:
        self._log("request_failed", message, url=url, retry_count=retry_count)

    def parse_error(
        self, url: str | None, message: str = "Failed to parse response"
    ) -> None:
        self._log("parse_error", message, url=url, retry_count=0)

    def ingestion_error(
        self, url: str | None, message: str, retry_count: int = 0
    ) -> None:
        self._log("ingestion_error", message, url=url, retry_count=retry_count)

    def page_empty(
        self, url: str, message: str = "Page returned no products"
    ) -> None:
        self._log("page_empty", message, url=url, retry_count=0)

    def transform_error(
        self, url: str | None, message: str = "Failed to transform product"
    ) -> None:
        self._log("transform_error", message, url=url, retry_count=0)

    def retry_exhausted(
        self, url: str, retry_count: int, message: str = "All retries exhausted"
    ) -> None:
        self._log("retry_exhausted", message, url=url, retry_count=retry_count)

    def network_error(
        self, url: str, message: str
    ) -> None:
        self._log("network_error", message, url=url, retry_count=0)

    def progress(self, message: str) -> None:
        self._log("progress", message)


def get_logger(platform: str) -> ScraperLoggerAdapter | StructuredLogger:
    if _HAS_CENTRALIZED:
        return ScraperLoggerAdapter(platform)
    return StructuredLogger(platform)