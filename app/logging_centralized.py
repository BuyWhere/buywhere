"""
Centralized structured logging for BuyWhere microservices.

Provides:
- Consistent JSON log format across all services
- stdout output for container log collection (Docker json-file driver)
- Optional file output for local debugging
- Standard fields: service_name, trace_id, level, timestamp, message
- OpenTelemetry trace context propagation

Usage:
    from app.logging_centralized import get_logger

    logger = get_logger("api-service")
    logger.info("Request processed", extra={"request_id": "123", "duration_ms": 50})
"""

import json
import logging
import os
import sys
import traceback
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Optional

trace_id_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)
span_id_var: ContextVar[Optional[str]] = ContextVar("span_id", default=None)

_LOG_LEVELS = {"DEBUG": logging.DEBUG, "INFO": logging.INFO, "WARNING": logging.WARNING, "ERROR": logging.ERROR, "CRITICAL": logging.CRITICAL}


class CentralizedLogger:
    def __init__(
        self,
        service_name: str,
        log_level: str = None,
        output_file: str = None,
    ):
        self.service_name = service_name
        level_str = log_level or os.environ.get("LOG_LEVEL", "INFO")
        self.log_level = _LOG_LEVELS.get(level_str.upper(), logging.INFO)
        self._out = sys.stdout
        self._file_handle = None
        if output_file:
            self._file_handle = open(output_file, "a", encoding="utf-8")

    def _format_log(self, level: str, message: str, extra: Dict[str, Any] = None) -> Dict[str, Any]:
        entry = {
            "service": self.service_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
        }

        trace_id = trace_id_var.get()
        if trace_id:
            entry["trace_id"] = trace_id

        span_id = span_id_var.get()
        if span_id:
            entry["span_id"] = span_id

        if extra:
            entry.update(extra)

        return entry

    def _emit(self, level: str, message: str, extra: Dict[str, Any] = None) -> None:
        entry = self._format_log(level, message, extra)
        line = json.dumps(entry, ensure_ascii=False)
        self._out.write(line + "\n")
        self._out.flush()
        if self._file_handle:
            self._file_handle.write(line + "\n")
            self._file_handle.flush()

    def debug(self, message: str, extra: Dict[str, Any] = None) -> None:
        self._emit("DEBUG", message, extra)

    def info(self, message: str, extra: Dict[str, Any] = None) -> None:
        self._emit("INFO", message, extra)

    def warning(self, message: str, extra: Dict[str, Any] = None) -> None:
        self._emit("WARNING", message, extra)

    def error(self, message: str, extra: Dict[str, Any] = None) -> None:
        self._emit("ERROR", message, extra)

    def critical(self, message: str, extra: Dict[str, Any] = None) -> None:
        self._emit("CRITICAL", message, extra)

    def exception(self, message: str, extra: Dict[str, Any] = None) -> None:
        if extra is None:
            extra = {}
        extra["exception"] = traceback.format_exc()
        self._emit("ERROR", message, extra)


_loggers: Dict[str, CentralizedLogger] = {}


def get_logger(
    service_name: str = None,
    log_level: str = None,
    output_file: str = None,
) -> CentralizedLogger:
    global _loggers
    key = f"{service_name}:{output_file}"
    if key not in _loggers:
        _loggers[key] = CentralizedLogger(
            service_name=service_name or "unknown",
            log_level=log_level or os.environ.get("LOG_LEVEL", "INFO"),
            output_file=output_file,
        )
    return _loggers[key]


def set_trace_context(trace_id: str = None, span_id: str = None) -> None:
    trace_id_var.set(trace_id or str(uuid.uuid4()))
    span_id_var.set(span_id or str(uuid.uuid4())[:8])


def clear_trace_context() -> None:
    trace_id_var.set(None)
    span_id_var.set(None)


def log_request(
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    request_id: str = None,
    user_agent: str = None,
    api_key_hash: str = None,
    ip: str = None,
    extra: Dict[str, Any] = None,
) -> None:
    logger = get_logger("api-service")
    log_data = {
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": round(duration_ms, 2),
        "request_id": request_id or str(uuid.uuid4()),
    }
    if user_agent:
        log_data["user_agent"] = user_agent
    if api_key_hash:
        log_data["api_key_hash"] = api_key_hash
    if ip:
        log_data["ip"] = ip
    if extra:
        log_data.update(extra)

    level = "ERROR" if status_code >= 500 else "WARNING" if status_code >= 400 else "INFO"
    logger._emit(level, "HTTP Request", log_data)


def log_scraper_progress(
    scraper_name: str,
    status: str,
    items_scraped: int = 0,
    items_total: int = 0,
    error: str = None,
    duration_ms: float = None,
    extra: Dict[str, Any] = None,
) -> None:
    logger = get_logger("scraper-fleet")
    log_data = {
        "scraper_name": scraper_name,
        "status": status,
        "items_scraped": items_scraped,
        "items_total": items_total,
    }
    if error:
        log_data["error"] = error
    if duration_ms is not None:
        log_data["duration_ms"] = round(duration_ms, 2)
    if extra:
        log_data.update(extra)

    level = "ERROR" if status == "failed" else "WARNING" if status in ("retrying", "blocked") else "INFO"
    logger._emit(level, "Scraper Progress", log_data)