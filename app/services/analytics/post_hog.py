import os
import logging
from typing import Optional, Any

from posthog import Posthog

logger = logging.getLogger("buywhere_api")

POSTHOG_PROJECT_KEY = os.environ.get("POSTHOG_PROJECT_KEY")
POSTHOG_HOST = os.environ.get("POSTHOG_HOST", "https://app.posthog.com")
POSTHOG_DISABLED = os.environ.get("POSTHOG_DISABLED", "false").lower() in ("true", "1", "yes")

_client: Optional[Posthog] = None


def get_client() -> Optional[Posthog]:
    global _client
    if POSTHOG_DISABLED:
        return None
    if POSTHOG_PROJECT_KEY is None:
        return None
    if _client is None:
        _client = Posthog(
            project_api_key=POSTHOG_PROJECT_KEY,
            host=POSTHOG_HOST,
            sync_mode=True,
        )
    return _client


def track_event(
    event: str,
    properties: Optional[dict] = None,
    distinct_id: Optional[str] = None,
) -> None:
    client = get_client()
    if client is None:
        return
    try:
        client.capture(
            distinct_id=distinct_id or "anonymous",
            event=event,
            properties=properties or {},
        )
    except Exception as e:
        logger.warning(f"Failed to capture PostHog event '{event}': {e}")


def track_signup(
    developer_id: str,
    email: str,
    experiment_variant: Optional[str] = None,
    discovery_path: Optional[str] = None,
    referrer: Optional[str] = None,
    utm_source: Optional[str] = None,
    utm_medium: Optional[str] = None,
    utm_campaign: Optional[str] = None,
    utm_content: Optional[str] = None,
    utm_term: Optional[str] = None,
) -> None:
    properties: dict[str, Any] = {
        "email_hash": email.lower().strip(),
        "environment": os.environ.get("ENVIRONMENT", "development"),
    }
    if experiment_variant:
        properties["experiment_variant"] = experiment_variant
    if discovery_path:
        properties["discovery_path"] = discovery_path
    if referrer:
        properties["referrer"] = referrer
    if utm_source:
        properties["utm_source"] = utm_source
    if utm_medium:
        properties["utm_medium"] = utm_medium
    if utm_campaign:
        properties["utm_campaign"] = utm_campaign
    if utm_content:
        properties["utm_content"] = utm_content
    if utm_term:
        properties["utm_term"] = utm_term

    track_event("developer_signup", properties=properties, distinct_id=developer_id)


def track_api_key_first_query(
    developer_id: str,
    api_key_id: str,
    latency_seconds: Optional[float] = None,
    endpoint: Optional[str] = None,
) -> None:
    properties: dict[str, Any] = {
        "api_key_id": api_key_id,
    }
    if latency_seconds is not None:
        properties["latency_seconds"] = latency_seconds
    if endpoint:
        properties["first_endpoint"] = endpoint

    track_event("api_key_first_query", properties=properties, distinct_id=developer_id)


def track_page_view(
    distinct_id: str,
    path: str,
    referrer: Optional[str] = None,
    utm_source: Optional[str] = None,
    utm_medium: Optional[str] = None,
    utm_campaign: Optional[str] = None,
) -> None:
    properties: dict[str, Any] = {
        "path": path,
    }
    if referrer:
        properties["referrer"] = referrer
    if utm_source:
        properties["utm_source"] = utm_source
    if utm_medium:
        properties["utm_medium"] = utm_medium
    if utm_campaign:
        properties["utm_campaign"] = utm_campaign

    track_event("page_view", properties=properties, distinct_id=distinct_id)


def track_affiliate_click(
    distinct_id: str,
    product_id: str,
    merchant: str,
    affiliate_link: str,
) -> None:
    properties = {
        "product_id": product_id,
        "merchant": merchant,
        "affiliate_link": affiliate_link,
    }
    track_event("affiliate_click", properties=properties, distinct_id=distinct_id)


def shutdown() -> None:
    global _client
    if _client is not None:
        try:
            _client.shutdown()
        except Exception:
            pass
        _client = None
