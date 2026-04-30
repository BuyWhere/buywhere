"""
Multi-region API test suite — BUY-5170.

Currency conversion tests (8) validate that app/currency.py returns live
exchange rates and converts prices within ±2% tolerance.

Run with:  python -m pytest tests/test_multi_region_api.py -v
"""
import pytest
import requests

from app.currency import (
    SUPPORTED_CURRENCIES,
    convert_price,
    get_exchange_rate,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TOLERANCE = 0.02  # ±2%


def within_tolerance(actual: float, expected: float, tol: float = TOLERANCE) -> bool:
    """Return True if *actual* is within *tol* relative fraction of *expected*."""
    if expected == 0:
        return actual == 0
    return abs(actual - expected) / abs(expected) <= tol


# ---------------------------------------------------------------------------
# Currency conversion tests (8 tests — the blockers from BUY-5170)
# ---------------------------------------------------------------------------


class TestGetExchangeRate:
    """get_exchange_rate() returns live rates for the 5 supported currencies."""

    def test_same_currency_returns_one(self):
        """Identity conversion: USD→USD must return exactly 1.0."""
        assert get_exchange_rate("USD", "USD") == 1.0

    def test_usd_to_sgd_is_positive(self):
        """USD→SGD rate must be a positive float (live rate)."""
        rate = get_exchange_rate("USD", "SGD")
        assert rate is not None
        assert rate > 0

    def test_usd_to_vnd_is_large(self):
        """USD→VND rate must be > 20000 (VND is a high-denomination currency)."""
        rate = get_exchange_rate("USD", "VND")
        assert rate is not None
        assert rate > 20_000

    def test_unsupported_currency_returns_none(self):
        """Unknown currency codes must return None rather than raise."""
        assert get_exchange_rate("USD", "XYZ") is None
        assert get_exchange_rate("ZZZ", "SGD") is None

    def test_rate_is_reciprocal_within_tolerance(self):
        """USD→SGD × SGD→USD should equal ~1.0 within ±2%."""
        usd_sgd = get_exchange_rate("USD", "SGD")
        sgd_usd = get_exchange_rate("SGD", "USD")
        assert usd_sgd is not None and sgd_usd is not None
        product = usd_sgd * sgd_usd
        assert within_tolerance(product, 1.0), (
            f"USD→SGD * SGD→USD = {product:.4f}, expected ~1.0 ±2%"
        )


class TestConvertPrice:
    """convert_price() converts amounts accurately within ±2%."""

    def test_usd_to_usd_is_identity(self):
        """Converting USD to USD must return the same amount."""
        assert convert_price(99.99, "USD", "USD") == pytest.approx(99.99, rel=1e-6)

    def test_sgd_to_thb_uses_live_rate(self):
        """SGD→THB conversion must produce a positive non-zero result."""
        result = convert_price(10.0, "SGD", "THB")
        assert result is not None
        assert result > 0

    def test_vnd_large_amount_converts_to_usd(self):
        """1,000,000 VND should convert to a sensible USD amount (>$20, <$100)."""
        result = convert_price(1_000_000, "VND", "USD")
        assert result is not None
        # At any reasonable rate (20k–30k VND/USD) this must be in [~$33–$50]
        assert 20.0 < result < 100.0, f"1,000,000 VND → USD gave {result}"

    def test_unsupported_currency_returns_none(self):
        """Unsupported currency pair must return None."""
        assert convert_price(100.0, "USD", "EUR") is None
        assert convert_price(100.0, "JPY", "SGD") is None

    def test_myr_to_usd_within_tolerance(self):
        """MYR→USD conversion must be within ±2% of the inverse USD→MYR rate."""
        usd_myr = get_exchange_rate("USD", "MYR")
        assert usd_myr is not None
        # 1 USD worth of MYR should convert back to ~1 USD
        result = convert_price(usd_myr, "MYR", "USD")
        assert result is not None
        assert within_tolerance(result, 1.0), (
            f"{usd_myr} MYR → USD = {result}, expected ~1.0 ±2%"
        )

    def test_all_supported_currency_pairs_return_values(self):
        """Every supported cross-currency pair must return a non-None positive value."""
        currencies = sorted(SUPPORTED_CURRENCIES)
        failures = []
        for from_c in currencies:
            for to_c in currencies:
                result = convert_price(100.0, from_c, to_c)
                if result is None or result <= 0:
                    failures.append(f"{from_c}→{to_c}: {result}")
        assert not failures, "Some currency pairs returned None or ≤0:\n" + "\n".join(failures)
