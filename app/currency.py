"""
Currency conversion utilities for BuyWhere multi-region API.

Fetches live exchange rates from open.er-api.com (free, no API key required).
Rates are cached in-process for CACHE_TTL_SECONDS to avoid hammering the API
on every product lookup.

Supported currencies: USD, SGD, VND, THB, MYR
"""
import time
import logging
import requests

logger = logging.getLogger(__name__)

SUPPORTED_CURRENCIES = {"USD", "SGD", "VND", "THB", "MYR"}
RATES_URL = "https://open.er-api.com/v6/latest/{base}"
CACHE_TTL_SECONDS = 3600  # 1 hour

# In-process cache: { base_currency: (fetched_at, {currency: rate}) }
_rate_cache: dict[str, tuple[float, dict[str, float]]] = {}


def _fetch_rates(base: str) -> dict[str, float]:
    """Fetch exchange rates from open.er-api.com for *base* currency."""
    url = RATES_URL.format(base=base.upper())
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data.get("result") != "success":
        raise ValueError(f"Exchange rate API error for {base}: {data.get('error-type', 'unknown')}")
    return data["rates"]


def _get_rates(base: str) -> dict[str, float]:
    """Return cached or freshly-fetched rates for *base* currency."""
    base = base.upper()
    now = time.monotonic()
    cached = _rate_cache.get(base)
    if cached is not None:
        fetched_at, rates = cached
        if now - fetched_at < CACHE_TTL_SECONDS:
            return rates
    rates = _fetch_rates(base)
    _rate_cache[base] = (now, rates)
    return rates


def get_exchange_rate(from_currency: str, to_currency: str) -> float | None:
    """
    Return the exchange rate from *from_currency* to *to_currency*.

    Returns None only if either currency is unsupported.
    Raises requests.RequestException on network failure.

    Examples:
        get_exchange_rate("USD", "SGD")  # ~1.28
        get_exchange_rate("SGD", "USD")  # ~0.78
        get_exchange_rate("USD", "USD")  # 1.0
    """
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()

    if from_currency not in SUPPORTED_CURRENCIES or to_currency not in SUPPORTED_CURRENCIES:
        return None

    if from_currency == to_currency:
        return 1.0

    rates = _get_rates(from_currency)
    rate = rates.get(to_currency)
    if rate is None:
        logger.warning("Rate for %s not found in %s rates response", to_currency, from_currency)
        return None
    return float(rate)


def convert_price(amount: float, from_currency: str, to_currency: str) -> float | None:
    """
    Convert *amount* from *from_currency* to *to_currency*.

    Returns the converted amount rounded to 2 decimal places, or to 4 decimal
    places when the 2dp result would be zero for a non-zero input (e.g. very
    small VND amounts converted to USD).  Returns None if either currency is
    unsupported.

    Raises requests.RequestException on network failure.

    Examples:
        convert_price(100.0, "USD", "SGD")   # ~128.00
        convert_price(10000, "VND", "USD")   # ~0.38
        convert_price(50.0, "USD", "USD")    # 50.0
    """
    rate = get_exchange_rate(from_currency, to_currency)
    if rate is None:
        return None
    result = amount * rate
    rounded = round(result, 2)
    # Preserve precision for very small results (e.g. VND→USD at low amounts)
    if rounded == 0.0 and result != 0.0:
        rounded = round(result, 4)
    return rounded
