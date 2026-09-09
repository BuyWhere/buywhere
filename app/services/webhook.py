"""Webhook service stub."""
from typing import List


async def deliver_webhook(url: str, payload: dict) -> bool:
    return False

async def dispatch_deal_found_webhooks(products: List) -> int:
    return 0

async def dispatch_new_product_webhooks(products: List) -> int:
    return 0

async def dispatch_price_change_webhooks(changes: List) -> int:
    return 0

async def dispatch_stock_change_webhooks(changes: List) -> int:
    return 0
