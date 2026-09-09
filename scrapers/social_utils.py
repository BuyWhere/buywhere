#!/usr/bin/env python3
"""Shared utilities for social commerce scrapers.

Provides curl_cffi-based fetching with TLS fingerprint impersonation
for bypassing anti-bot detection on TikTok, Instagram, Pinterest.
"""

import json
import re
import time
import warnings
from typing import Optional
from urllib.parse import urlparse

# Suppress SSL warnings when using proxy (BrightData uses MITM SSL)
warnings.filterwarnings("ignore", message="Unverified HTTPS request")


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

SKIP_DOMAINS = {
    "tiktok.com", "linktr.ee", "beacons.ai", "msha.ke",
    "instagram.com", "facebook.com", "twitter.com", "x.com",
    "youtube.com", "youtu.be", "t.me", "wa.me", "discord.gg",
    "twitch.tv", "reddit.com", "pinterest.com", "snapchat.com",
    "amazon.com", "amazon.co", "ebay.com", "etsy.com",
    "onlyfans.com", "patreon.com", "substack.com",
    "pin.it", "app.link", "bit.ly", "tinyurl.com", "short.url",
    "goo.gl", "ow.ly", "buff.ly", "cutt.ly", "is.gd",
}


def clean_domain(url: str) -> Optional[str]:
    """Extract and clean a domain from a URL string."""
    try:
        if not url or url in ("null", "None", ""):
            return None
        parsed = urlparse(url if "://" in url else f"https://{url}")
        domain = parsed.netloc.lower().strip()
        if domain.startswith("www."):
            domain = domain[4:]
        # Skip social media and link aggregator domains
        if domain in SKIP_DOMAINS:
            return None
        for skip in SKIP_DOMAINS:
            if domain.endswith(f".{skip}"):
                return None
        if "." not in domain or len(domain) < 5:
            return None
        return domain
    except Exception:
        return None


def extract_urls_from_text(text: str) -> list[str]:
    """Extract URLs from raw text using common patterns."""
    urls = []
    if not text:
        return urls
    patterns = [
        r'https?://[^\s<>"\'{}|\\^`\[\]]+',
        r'"external_website"\s*:\s*"([^"]+)"',
        r'"external_url"\s*:\s*"([^"]+)"',
        r'"external_url_linkshimmed"\s*:\s*"([^"]+)"',
        r'"link"\s*:\s*"([^"]+)"',
        r'"website"\s*:\s*"([^"]+)"',
        r'"url"\s*:\s*"([^"]+)"',
        r'"domain_url"\s*:\s*"([^"]+)"',
    ]
    for pattern in patterns:
        matches = re.findall(pattern, str(text), re.IGNORECASE)
        for m in matches:
            m = m.strip().rstrip(",.);")
            if m and m != "null":
                # Skip social links
                if not any(skip in m.lower() for skip in SKIP_DOMAINS):
                    urls.append(m)
    return urls


def fetch_with_curl_cffi(
    url: str,
    proxy_url: Optional[str] = None,
    impersonate: str = "chrome124",
    timeout: int = 30,
    max_retries: int = 3,
) -> Optional[str]:
    """Fetch a URL using curl_cffi with TLS fingerprint impersonation.

    curl_cffi impersonates browser TLS fingerprints (Chrome, Safari, Firefox)
    to bypass anti-bot detection that httpx/requests can't handle.

    Args:
        url: The URL to fetch
        proxy_url: Optional proxy URL (http://user:pass@host:port)
        impersonate: Browser to impersonate (chrome110, chrome124, safari, etc.)
        timeout: Request timeout in seconds
        max_retries: Number of retry attempts

    Returns:
        Response text if successful, None otherwise
    """
    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        return None

    for attempt in range(max_retries):
        try:
            resp = curl_requests.get(
                url,
                proxy=proxy_url,
                impersonate=impersonate,
                timeout=timeout,
                verify=False,  # BrightData proxies use SSL interception
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                },
            )
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
            elif resp.status_code in (429, 403, 503):
                wait = (2 ** attempt) * 3
                print(f"    Rate limited (HTTP {resp.status_code}), waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    HTTP {resp.status_code}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    return None
        except Exception as e:
            print(f"    Error: {type(e).__name__}: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                return None
    return None


def fetch_json_with_curl_cffi(
    url: str,
    proxy_url: Optional[str] = None,
    impersonate: str = "chrome124",
    timeout: int = 30,
    max_retries: int = 3,
) -> Optional[dict]:
    """Fetch JSON from a URL using curl_cffi.

    Returns parsed JSON dict, or None on failure.
    """
    text = fetch_with_curl_cffi(url, proxy_url, impersonate, timeout, max_retries)
    if text:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return None
