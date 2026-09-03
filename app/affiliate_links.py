"""
BuyWhere Affiliate Link Wrapper
===============================
Converts raw product URLs (Shopee SG, Lazada SG) into tracked affiliate links.

Production credentials (optional — graceful fallback if absent):
  Shopee:  SHOPEE_AFFILIATE_ID  — your Shopee Affiliate Portal publisher ID
  Lazada:  LAZADA_TRACKING_ID   — your Lazada Affiliate / Involve Asia tracking ID

Without credentials the module appends lightweight UTM / ref params so we can
at least measure referral traffic while full affiliate integration is pending.

Click Tracking:
  When TRACKING_BASE_URL is set, affiliate URLs are wrapped through a click
  tracking endpoint that records clicks before redirecting to the destination.
"""

import os
import re
from urllib.parse import quote

TRACKING_BASE_URL = os.environ.get("TRACKING_BASE_URL", "").rstrip("/")

_URL_PATTERN = re.compile(
    r"^https?://"
    r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|"
    r"localhost|"
    r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"
    r"(?::\d+)?"
    r"(?:/?|[/?]\S+)$",
    re.IGNORECASE,
)


def is_valid_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    return bool(_URL_PATTERN.match(url))


def _shopee_affiliate_url(product_url: str) -> str:
    shopee_affiliate_id = os.environ.get("SHOPEE_AFFILIATE_ID", "")
    if shopee_affiliate_id:
        encoded = quote(product_url, safe="")
        return f"https://shope.ee/api/v2/deep_link?affiliate_id={shopee_affiliate_id}&url={encoded}"
    sep = "&" if "?" in product_url else "?"
    return f"{product_url}{sep}ref=buywhere"


def _lazada_affiliate_url(product_url: str) -> str:
    lazada_tracking_id = os.environ.get("LAZADA_TRACKING_ID", "")
    if lazada_tracking_id:
        encoded = quote(product_url, safe="")
        return f"https://invol.co/cl{lazada_tracking_id}?p={encoded}"
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=catalog"
    sep = "&" if "?" in product_url else "?"
    return f"{product_url}{sep}{utm}"


def _awin_affiliate_url(product_url: str) -> str:
    awin_publisher_id = os.environ.get("AWIN_PUBLISHER_ID", "")
    awin_advertiser_ids = os.environ.get("AWIN_ADVERTISER_IDS", "")
    if awin_publisher_id and awin_advertiser_ids:
        encoded = quote(product_url, safe="")
        advertiser_ids = dict(x.split("=") for x in awin_advertiser_ids.split(",") if "=" in x)
        for platform_key, advertiser_id in advertiser_ids.items():
            return f"https://www.awin1.com/creader.php?awinmid={advertiser_id}&awinaffid={awin_publisher_id}&clickref=&p={encoded}"
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=catalog"
    sep = "&" if "?" in product_url else "?"
    return f"{product_url}{sep}{utm}"


def _template_affiliate_url(
    product_url: str,
    template_env_var: str,
    default_campaign: str,
) -> str:
    """Build merchant-specific affiliate URLs from a configurable template.

    The env var can include either ``{url}`` or ``{encoded_url}`` placeholders.
    Until Biz Dev provides live merchant templates, fall back to BuyWhere UTMs.
    """
    template = os.environ.get(template_env_var, "").strip()
    if template:
        encoded = quote(product_url, safe="")
        return template.format(url=product_url, encoded_url=encoded)
    return _inject_utm_params(product_url, "buywhere", "affiliate", default_campaign)


def _challenger_affiliate_url(product_url: str) -> str:
    return _template_affiliate_url(
        product_url,
        "CHALLENGER_AFFILIATE_URL_TEMPLATE",
        "challenger-catalog",
    )


def _decathlon_affiliate_url(product_url: str) -> str:
    return _template_affiliate_url(
        product_url,
        "DECATHLON_AFFILIATE_URL_TEMPLATE",
        "decathlon-catalog",
    )


def _zalora_affiliate_url(product_url: str) -> str:
    return _template_affiliate_url(
        product_url,
        "ZALORA_AFFILIATE_URL_TEMPLATE",
        "zalora-catalog",
    )


def _amazon_sg_affiliate_url(product_url: str) -> str:
    amazon_sg_tag = os.environ.get("AMAZON_ASSOCIATE_TAG") or os.environ.get("AFFILIATE_TAG", "")
    asin_match = re.search(r"/dp/([A-Z0-9]{10})", product_url, re.IGNORECASE)
    if not asin_match:
        asin_match = re.search(r"/gp/product/([A-Z0-9]{10})", product_url, re.IGNORECASE)
    if not asin_match:
        return product_url
    sep = "&" if "?" in product_url else "?"
    if amazon_sg_tag:
        return f"{product_url}{sep}tag={amazon_sg_tag}&linkCode=ll"
    return product_url


def _amazon_us_affiliate_url(product_url: str) -> str:
    amazon_us_tag = os.environ.get("AMAZON_US_ASSOCIATE_TAG", "buywhere-20")
    asin_match = re.search(r"/dp/([A-Z0-9]{10})", product_url, re.IGNORECASE)
    if not asin_match:
        asin_match = re.search(r"/gp/product/([A-Z0-9]{10})", product_url, re.IGNORECASE)
    if not asin_match:
        asin_match = re.search(r"/product/([A-Z0-9]{10})", product_url, re.IGNORECASE)
    asin = asin_match.group(1) if asin_match else None
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=amazon-us"
    sep = "&" if "?" in product_url else "?"
    if asin:
        return f"{product_url}{sep}tag={amazon_us_tag}&linkCode=ll&{utm}"
    return f"{product_url}{sep}{utm}"


def _walmart_us_affiliate_url(product_url: str) -> str:
    walmart_affiliate_id = os.environ.get("WALMART_AFFILIATE_ID", "")
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=walmart-us"
    sep = "&" if "?" in product_url else "?"
    if walmart_affiliate_id:
        return f"{product_url}{sep}affiliate_id={walmart_affiliate_id}&{utm}"
    return f"{product_url}{sep}{utm}"


def _bestbuy_us_affiliate_url(product_url: str) -> str:
    bestbuy_affiliate_id = os.environ.get("BESTBUY_AFFILIATE_ID", "")
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=bestbuy-us"
    sep = "&" if "?" in product_url else "?"
    if bestbuy_affiliate_id:
        return f"{product_url}{sep}ref={bestbuy_affiliate_id}&{utm}"
    return f"{product_url}{sep}{utm}"


def _target_us_affiliate_url(product_url: str) -> str:
    target_affiliate_id = os.environ.get("TARGET_AFFILIATE_ID", "")
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=target-us"
    sep = "&" if "?" in product_url else "?"
    if target_affiliate_id:
        return f"{product_url}{sep}affid={target_affiliate_id}&{utm}"
    return f"{product_url}{sep}{utm}"


def _ebay_us_affiliate_url(product_url: str) -> str:
    ebay_affiliate_id = os.environ.get("EBAY_US_AFFILIATE_ID", "")
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=ebay-us"
    sep = "&" if "?" in product_url else "?"
    if ebay_affiliate_id:
        return f"{product_url}{sep}mkevt=1&mkcid=1&mkrid=711-53200-19255-0&affiliate_id={ebay_affiliate_id}&campid=auction_creation&{utm}"
    return f"{product_url}{sep}{utm}"


def _wayfair_us_affiliate_url(product_url: str) -> str:
    wayfair_affiliate_id = os.environ.get("WAYFAIR_US_AFFILIATE_ID", "")
    utm = "utm_source=buywhere&utm_medium=affiliate&utm_campaign=wayfair-us"
    sep = "&" if "?" in product_url else "?"
    if wayfair_affiliate_id:
        return f"{product_url}{sep}ref=affiliate_id:{wayfair_affiliate_id}&{utm}"
    return f"{product_url}{sep}{utm}"


_PLATFORM_HANDLERS = {
    "shopee": _shopee_affiliate_url,
    "shopee-sg": _shopee_affiliate_url,
    "shopee.sg": _shopee_affiliate_url,
    "shopee_sg": _shopee_affiliate_url,
    "lazada": _lazada_affiliate_url,
    "lazada.sg": _lazada_affiliate_url,
    "lazada_sg": _lazada_affiliate_url,
    "zalora.sg": _zalora_affiliate_url,
    "zalora_sg": _zalora_affiliate_url,
    "asos_sg": _awin_affiliate_url,
    "challenger": _challenger_affiliate_url,
    "challenger.sg": _challenger_affiliate_url,
    "challenger_sg": _challenger_affiliate_url,
    "decathlon": _decathlon_affiliate_url,
    "decathlon_sg": _decathlon_affiliate_url,
    "hp_sg": _awin_affiliate_url,
    "lenovo_sg": _awin_affiliate_url,
    "underarmour_sg": _awin_affiliate_url,
    "etsy_sg": _awin_affiliate_url,
    "marksandspencer_sg": _awin_affiliate_url,
    "amazon.sg": _amazon_sg_affiliate_url,
    "amazon_sg": _amazon_sg_affiliate_url,
    "amazon_sg_toys": _amazon_sg_affiliate_url,
    "amazon_us": _amazon_us_affiliate_url,
    "walmart_us": _walmart_us_affiliate_url,
    "bestbuy_us": _bestbuy_us_affiliate_url,
    "target_us": _target_us_affiliate_url,
    "ebay_us": _ebay_us_affiliate_url,
    "wayfair_us": _wayfair_us_affiliate_url,
}


def _inject_utm_params(url: str, utm_source: str | None, utm_medium: str | None, utm_campaign: str | None) -> str:
    """Append UTM parameters to a URL.
    
    Args:
        url:           The URL to append UTM parameters to.
        utm_source:    utm_source value (e.g. "buywhere").
        utm_medium:    utm_medium value (e.g. "compare", "affiliate").
        utm_campaign:  utm_campaign value (e.g. product slug).
    
    Returns:
        URL with UTM parameters appended.
    """
    if not url or not utm_source:
        return url
    
    params = [f"utm_source={quote(utm_source, safe='')}"]
    if utm_medium:
        params.append(f"utm_medium={quote(utm_medium, safe='')}")
    if utm_campaign:
        params.append(f"utm_campaign={quote(utm_campaign, safe='')}")
    
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}{'&'.join(params)}"


def get_affiliate_url(
    platform: str,
    product_url: str,
    product_id: int | None = None,
    agent_id: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
) -> str:
    """Return a tracked affiliate URL for the given product.

    Args:
        platform:     Source platform identifier, e.g. ``"shopee_sg"`` or
                      ``"lazada_sg"``.
        product_url: The raw product URL from the catalog.
        product_id:  Optional product ID for click tracking.
        agent_id:    Optional agent ID for agent-native click tracking.
        utm_medium: Optional utm_medium override (e.g. "compare").
        utm_campaign: Optional utm_campaign value (e.g. product slug).

    Returns:
        A tracked affiliate URL.  If the platform is unrecognised or the
        original URL is falsy/invalid, the original URL is returned unchanged.
    """
    if not product_url or not is_valid_url(product_url):
        return product_url

    handler = _PLATFORM_HANDLERS.get(platform)
    if handler is None:
        return product_url

    affiliate_url = handler(product_url)

    if utm_medium or utm_campaign:
        affiliate_url = _inject_utm_params(affiliate_url, "buywhere", utm_medium, utm_campaign)

    if TRACKING_BASE_URL and product_id:
        tracking_id = _generate_tracking_id(product_id, platform, agent_id)
        return f"{TRACKING_BASE_URL}/v1/go/{tracking_id}?agent_id={agent_id}" if agent_id else f"{TRACKING_BASE_URL}/v1/go/{tracking_id}"

    return affiliate_url


def get_underlying_affiliate_url(platform: str, product_url: str) -> str:
    """Return the raw affiliate URL without tracking wrapper (for click recording)."""
    if not product_url or not is_valid_url(product_url):
        return product_url

    handler = _PLATFORM_HANDLERS.get(platform)
    if handler is None:
        return product_url

    return handler(product_url)


def _generate_tracking_id(product_id: int, platform: str, agent_id: str | None = None) -> str:
    import base64
    import hashlib
    import time
    raw = f"{product_id}:{platform}:{agent_id or ''}:{time.time_ns()}"
    digest = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()[:12]).decode().rstrip("=")
    return f"{product_id}_{digest}"


def parse_tracking_id(tracking_id: str) -> tuple[int, str] | None:
    try:
        parts = tracking_id.split("_", 1)
        if len(parts) != 2:
            return None
        product_id = int(parts[0])
        return (product_id, parts[1])
    except (ValueError, IndexError):
        return None


def parse_tracking_id_with_agent(tracking_id: str) -> tuple[int, str, str | None]:
    """Parse tracking ID and extract agent_id from the digest.
    
    The tracking_id format is {product_id}_{digest} where digest is a base64-encoded
    SHA256 hash of {product_id}:{platform}:{agent_id}:{timestamp}.
    
    Since we can't reverse the hash, we return the raw agent_id placeholder.
    For proper agent tracking, use the tracking_id directly with agent-aware endpoints.
    """
    try:
        parts = tracking_id.split("_", 1)
        if len(parts) != 2:
            return (0, "", None)
        product_id = int(parts[0])
        return (product_id, parts[1], None)
    except (ValueError, IndexError):
        return (0, "", None)


def build_agent_tracking_id(product_id: int, platform: str, agent_id: str | None = None) -> str:
    """Generate a tracking ID that encodes agent context for click attribution.
    
    The tracking_id format is {product_id}_{agent_prefix}_{nonce}
    where agent_prefix is a short identifier derived from agent_id.
    """
    import base64
    import hashlib
    import time
    
    agent_prefix = ""
    if agent_id:
        agent_hash = hashlib.sha256(agent_id.encode()).digest()[:4]
        agent_prefix = base64.urlsafe_b64encode(agent_hash).decode().rstrip("=").replace("+", "").replace("/", "")
    
    nonce = str(time.time_ns())[-8:]
    if agent_prefix:
        raw = f"{product_id}:{platform}:{agent_id}:{nonce}"
    else:
        raw = f"{product_id}:{platform}:{nonce}"
    
    digest = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()[:8]).decode().rstrip("=")
    if agent_prefix:
        return f"{product_id}_{agent_prefix}_{digest}"
    return f"{product_id}_{digest}"


def extract_agent_from_tracking_id(tracking_id: str) -> str | None:
    """Extract agent_id prefix from tracking ID.
    
    Returns the agent_id if encoded, otherwise None.
    """
    try:
        parts = tracking_id.split("_")
        if len(parts) >= 3:
            return parts[1]
        return None
    except (ValueError, IndexError):
        return None
