"""Unit tests for app.currency — BUY-57489 fx-refresh.

Covers:
* Triangulation through the USD pivot using a known USD-rate table.
* DB-loaded rates correctly overriding the fallback table (mocked).
* Stale / empty / failing DB responses keeping the fallback table intact.
* Header helpers (``get_rate_for_header``, ``build_currency_headers``).
* Decimal compatibility.
"""
from __future__ import annotations

import os
import sys
from decimal import Decimal

import pytest

# Ensure repo root is on sys.path so ``import app.currency`` works in CI.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from app import currency as cur  # noqa: E402


# A fixed USD-keyed table used by every test that doesn't care about live data:
#   usd_rates[X] = "units of X per 1 USD"
# 1 USD = 0.92 EUR, 1 USD = 1.35 SGD, 1 USD = 25,500 VND, etc.
_KNOWN_USD_RATES = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 156.0,
    "MYR": 4.70,
    "IDR": 16_000.0,
    "THB": 36.0,
    "PHP": 56.0,
    "VND": 25_500.0,
    "SGD": 1.35,
}


@pytest.fixture(autouse=True)
def _prime_cache():
    """Each test starts with a deterministic USD-rate table (no DB hits)."""
    cur._CACHE["rates_usd"] = dict(_KNOWN_USD_RATES)
    cur._CACHE["sources"] = {k: "test" for k in _KNOWN_USD_RATES}
    cur._CACHE["loaded_at"] = 10**12   # far future — TTL won't trigger DB reload
    cur._CACHE["db_attempts"] = 0
    cur._CACHE["db_last_error"] = None
    yield


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------
class TestSupportedCurrencies:
    def test_includes_buy_57489_target_set(self):
        for c in ("USD", "EUR", "GBP", "JPY", "MYR", "IDR", "THB", "PHP", "VND", "SGD"):
            assert c in cur.SUPPORTED_CURRENCIES

    def test_all_fallback_pairs_are_listed(self):
        for c in cur._FALLBACK_USD_RATES:
            assert c in cur.SUPPORTED_CURRENCIES


# ---------------------------------------------------------------------------
# Triangulation against the primed USD-rate table
# ---------------------------------------------------------------------------
class TestTriangulation:
    def test_convert_same_currency_is_identity(self):
        assert cur.convert_price(123.0, "USD", "USD") == 123.0
        assert cur.convert_price(99, "SGD", "sgd") == 99  # case-insensitive

    def test_convert_zero_is_zero(self):
        assert cur.convert_price(0, "USD", "EUR") == 0.0

    def test_convert_none_price_returns_none(self):
        assert cur.convert_price(None, "USD", "EUR") is None

    def test_convert_unknown_currency_returns_none(self):
        assert cur.convert_price(100.0, "USD", "ZZZ") is None
        assert cur.convert_price(100.0, "ZZZ", "USD") is None

    def test_usd_to_eur(self):
        # 100 USD -> 92 EUR (rate 0.92)
        assert cur.convert_price(100.0, "USD", "EUR") == pytest.approx(92.0, rel=1e-9)

    def test_eur_to_usd(self):
        # 92 EUR -> 100 USD
        assert cur.convert_price(92.0, "EUR", "USD") == pytest.approx(100.0, rel=1e-9)

    def test_eur_to_gbp_cross(self):
        # 1 EUR = 0.92 USD = 0.92 / (1/0.79) = 0.92 * 0.79 / 1 ≈ 0.7268 GBP
        result = cur.convert_price(100.0, "EUR", "GBP")
        expected = 100.0 * (_KNOWN_USD_RATES["GBP"] / _KNOWN_USD_RATES["EUR"])
        assert result == pytest.approx(expected, rel=1e-9)

    def test_vnd_is_supported(self):
        # VND isn't in frankfurter, but must still resolve through the table.
        rate = cur.get_exchange_rate("USD", "VND")
        assert rate == pytest.approx(25_500.0, rel=1e-9)
        converted = cur.convert_price(100.0, "USD", "VND")
        assert converted == pytest.approx(2_550_000.0, rel=1e-9)

    def test_round_trip_is_close_to_identity(self):
        for ccy in ("EUR", "GBP", "JPY", "MYR", "SGD", "VND"):
            forward = cur.convert_price(250.0, "USD", ccy)
            assert forward is not None
            back = cur.convert_price(forward, ccy, "USD")
            assert back == pytest.approx(250.0, rel=1e-9), ccy


class TestExchangeRate:
    def test_same_currency_returns_one(self):
        assert cur.get_exchange_rate("USD", "USD") == 1.0

    def test_missing_returns_none(self):
        assert cur.get_exchange_rate("USD", None) is None
        assert cur.get_exchange_rate(None, "USD") is None
        assert cur.get_exchange_rate("USD", "") is None

    def test_usd_to_eur_uses_known_rate(self):
        assert cur.get_exchange_rate("USD", "EUR") == pytest.approx(0.92, rel=1e-9)


class TestHeaderHelpers:
    def test_get_rate_for_header_returns_none_for_same_currency(self):
        # Callers skip emitting the header when conversion wasn't necessary.
        assert cur.get_rate_for_header("USD", "USD") is None

    def test_get_rate_for_header_rounds(self):
        rate = cur.get_rate_for_header("USD", "EUR")
        assert rate is not None
        assert isinstance(rate, float)
        # 6-digit rounding — no scientific notation, no 12-digit float noise.
        assert rate == round(_KNOWN_USD_RATES["EUR"], 6)

    def test_build_currency_headers_uses_usd_pivot(self):
        headers = cur.build_currency_headers("EUR")
        assert headers.get("X-Currency-Target") == "EUR"
        assert "X-Currency-Rate" in headers
        assert headers["X-Currency-Rate"].endswith(" EUR")
        assert "0.92" in headers["X-Currency-Rate"]

    def test_build_currency_headers_skips_unknown(self):
        assert cur.build_currency_headers(None) == {}
        assert cur.build_currency_headers("ZZZ") == {}


# ---------------------------------------------------------------------------
# DB-loaded override (mocked engine)
# ---------------------------------------------------------------------------
class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return list(self._rows)


class _FakeConnection:
    def __init__(self, rows):
        self._rows = rows
        self.last_sql = None
        self.last_params = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, stmt, params=None):
        self.last_sql = str(stmt)
        self.last_params = params
        return _FakeResult(self._rows)


class _FakeEngine:
    last_instance = None

    def __init__(self, url, future=True):
        self.url = url
        self.rows = _FakeEngine.last_instance.rows if _FakeEngine.last_instance else []
        self._conn = _FakeConnection(self.rows)
        self.last_sql = None
        self.last_params = None

    def connect(self):
        return _FakeConnection(self.rows)

    def dispose(self):
        pass


class TestDbOverride:
    def _install_fake_engine(self, rows):
        _FakeEngine.last_instance = type("R", (), {"rows": rows})()
        import sqlalchemy
        original = sqlalchemy.create_engine
        sqlalchemy.create_engine = _FakeEngine
        try:
            cur._CACHE["loaded_at"] = 0.0  # force refresh
            cur._refresh_cache()
        finally:
            sqlalchemy.create_engine = original

    def test_db_rows_override_fallback(self):
        # 1 EUR = 1.50 USD  ->  1 USD = 1/1.5 = 0.6667 EUR
        # 1 EUR = 1.00 EUR  (identity)
        rows = [
            ("EUR", "USD", 1.50, "frankfurter", None),
            ("EUR", "EUR", 1.00, "frankfurter", None),
        ]
        self._install_fake_engine(rows)

        assert cur.get_exchange_rate("USD", "EUR") == pytest.approx(1/1.5, rel=1e-9)
        assert cur.get_exchange_rate("EUR", "USD") == pytest.approx(1.5, rel=1e-9)
        # Source attribution preserved
        assert cur._CACHE["sources"].get("USD") == "frankfurter"

    def test_empty_db_keeps_fallback(self):
        # If DB returns zero rows we keep the previous (fallback) table.
        prev_rates = dict(cur._CACHE["rates_usd"])
        self._install_fake_engine([])
        assert cur._CACHE["rates_usd"] == prev_rates

    def test_db_query_filters_by_max_age(self):
        _FakeEngine.last_instance = type("R", (), {"rows": []})()
        import sqlalchemy
        original = sqlalchemy.create_engine
        sqlalchemy.create_engine = _FakeEngine
        try:
            cur._CACHE["loaded_at"] = 0.0
            cur._refresh_cache()
        finally:
            sqlalchemy.create_engine = original

        # Replay with a capturing engine to inspect the SQL.
        captured: dict = {}

        class CaptureConn(_FakeConnection):
            def execute(self, stmt, params=None):
                captured["sql"] = str(stmt)
                captured["params"] = params
                return _FakeResult([])

        class CaptureEngine(_FakeEngine):
            def connect(self):
                return CaptureConn([])

        sqlalchemy.create_engine = CaptureEngine
        try:
            cur._CACHE["loaded_at"] = 0.0
            cur._refresh_cache()
        finally:
            sqlalchemy.create_engine = original

        assert "max_age" in captured["params"]
        assert "base_currency = 'EUR'" in captured["sql"]

    def test_db_failure_keeps_cache_and_records_error(self):
        import sqlalchemy
        def boom(*args, **kwargs):
            raise RuntimeError("simulated outage")
        original = sqlalchemy.create_engine
        sqlalchemy.create_engine = boom
        try:
            cur._CACHE["loaded_at"] = 0.0
            cur._refresh_cache()
        finally:
            sqlalchemy.create_engine = original
        # Cache stays populated with the previously known table.
        assert cur._CACHE["rates_usd"]["USD"] == 1.0
        assert "simulated outage" in (cur._CACHE["db_last_error"] or "")


class TestCacheDiagnostics:
    def test_get_cache_stats_returns_dict(self):
        stats = cur.get_cache_stats()
        assert "rates_count" in stats
        assert "ttl_seconds" in stats
        assert stats["rates_count"] >= 10

    def test_warm_cache_returns_rates(self):
        rates = cur.warm_cache(force=True)
        assert isinstance(rates, dict)
        assert "USD" in rates


class TestIsSupported:
    def test_known_currency(self):
        assert cur.is_supported("USD") is True
        assert cur.is_supported("vnd") is True  # case-insensitive

    def test_unknown_currency(self):
        assert cur.is_supported("XYZ") is False
        assert cur.is_supported(None) is False
        assert cur.is_supported("") is False


# ---------------------------------------------------------------------------
# Decimal compatibility (some callers pass Decimal prices)
# ---------------------------------------------------------------------------
class TestDecimalCompat:
    def test_convert_handles_decimal_input(self):
        result = cur.convert_price(Decimal("100"), "USD", "EUR")
        assert result == pytest.approx(92.0, rel=1e-9)
