"""Currency conversion stub."""
from typing import Optional

SUPPORTED_CURRENCIES = ["SGD", "USD", "EUR", "GBP", "AUD", "JPY", "KRW", "INR", "MYR", "THB", "IDR", "PHP", "VND", "HKD", "TWD", "CNY"]


def convert_price(price: float, from_currency: str, to_currency: str) -> Optional[float]:
    if from_currency == to_currency:
        return price
    return None


def build_currency_headers(currency: str) -> dict:
    return {}


def get_exchange_rate(from_currency: str, to_currency: str) -> Optional[float]:
    return None


def get_rate_for_header(from_currency: str, to_currency: str) -> Optional[float]:
    return None
