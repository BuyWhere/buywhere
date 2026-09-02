"""Currency service stub."""
from app.currency import SUPPORTED_CURRENCIES, convert_price, get_rate_for_header, get_exchange_rate, build_currency_headers

__all__ = ["SUPPORTED_CURRENCIES", "convert_price", "get_rate_for_header", "get_exchange_rate", "build_currency_headers"]

SUPPORTED_CURRENCIES = ["SGD", "USD", "EUR", "GBP", "AUD", "JPY", "KRW", "INR", "MYR", "THB"]

def convert_price(price, from_c, to_c):
    if from_c == to_c: return price
    return None

def get_rate_for_header(from_c, to_c):
    return None
