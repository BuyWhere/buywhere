"""GA4 analytics stub."""
async def track_event(event_name: str, params: dict = None) -> bool:
    return False


async def track_signup_complete(user_id: str, email: str) -> bool:
    return False
