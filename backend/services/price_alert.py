"""Price alert service stub."""
async def check_price_alerts(product_id: str, new_price: float) -> int:
    return 0


async def check_and_trigger_price_alerts(product_id: str, new_price: float, currency: str = "SGD") -> int:
    return 0
