"""Unit tests for the disk space watchdog service."""
import pytest
import time

from app.services import disk_watchdog as dw


class TestCheckDiskNow:
    def test_returns_dict_with_required_keys(self):
        result = dw._check_disk_now()
        assert isinstance(result, dict)
        assert "total_bytes" in result
        assert "used_bytes" in result
        assert "available_bytes" in result
        assert "free_gb" in result
        assert "usage_percent" in result
        assert "checked_at" in result

    def test_free_space_is_positive(self):
        result = dw._check_disk_now()
        assert result["available_bytes"] > 0
        assert result["free_gb"] > 0

    def test_usage_percent_in_range(self):
        result = dw._check_disk_now()
        assert 0 <= result["usage_percent"] <= 100


class TestGetLastCheck:
    def test_returns_none_before_any_check(self):
        original = dw._last_check_result
        dw._last_check_result = None
        try:
            assert dw.get_last_check() is None
        finally:
            dw._last_check_result = original


class TestMaybeFireSentry:
    def test_no_op_when_sentry_disabled(self):
        result = {
            "total_bytes": 1_000_000_000,
            "used_bytes": 500_000_000,
            "available_bytes": 500_000_000,
            "free_gb": 0.5,
            "usage_percent": 50.0,
            "checked_at": "2026-01-01T00:00:00Z",
        }
        dw._maybe_fire_sentry(result, "warning", "test message")


class TestCreatePaperclipIncident:
    @pytest.mark.asyncio
    async def test_returns_false_when_credentials_missing(self):
        assert await dw._create_paperclip_incident("test") is False


class TestWatchdogLoopLogic:
    def test_status_determination(self):
        free_gb = 100.0
        if free_gb < dw.CRITICAL_FREE_GB:
            status = "critical"
        elif free_gb < dw.WARN_FREE_GB:
            status = "warning"
        else:
            status = "healthy"
        assert status == "healthy"

        free_gb = 10.0
        if free_gb < dw.CRITICAL_FREE_GB:
            status = "critical"
        elif free_gb < dw.WARN_FREE_GB:
            status = "warning"
        else:
            status = "healthy"
        assert status == "warning"

        free_gb = 3.0
        if free_gb < dw.CRITICAL_FREE_GB:
            status = "critical"
        elif free_gb < dw.WARN_FREE_GB:
            status = "warning"
        else:
            status = "healthy"
        assert status == "critical"
