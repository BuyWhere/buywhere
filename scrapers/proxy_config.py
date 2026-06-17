"""Centralized BrightData proxy zone configuration.

Defines proxy zones and provides helpers for building proxy URLs,
Playwright config, and zone lookups. All credentials come from
environment variables so zones can be reconfigured without code changes.

Zones:
    DATACENTER_PROXY1 — datacenter proxy (fast, shared IPs)
    RESIDENTIAL_PROXY1 — residential proxy (rotating IPs, anti-bot)
    LEGACY_RESIDENTIAL — compat alias for the pre-BUY-10682 zone

Note: The BRIGHTDATA_API_KEY token (from SSM /buywhere/prod/BRIGHTDATA_API_KEY)
is valid for auth but currently lacks zone management permissions (returns 403).
Once zone management permissions are added to the token via BrightData dashboard,
run `python -m scrapers.provision_brightdata_zones` to create the zones.
"""

import os
import urllib.parse
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class Zone(str, Enum):
    DATACENTER_PROXY1 = "datacenter_proxy1"
    RESIDENTIAL_PROXY1 = "residential_proxy1"
    LEGACY_RESIDENTIAL = "residential"
    # BrightData Unlocker zones — bypass WAF/anti-bot with JS challenge solving
    WEB_UNLOCKER_VN = "web_unlocker_vn"
    SHOPEE_VN_UL = "shopee_vn_ul"
    # Lazada SG premium unlocker (BUY-51870) — has ub_premium:1 for lazada.sg access
    LAZADA_SG_WEB_UNLOCKER = "lazada_sg_premium_unlocker"


@dataclass(frozen=True)
class ZoneConfig:
    name: str
    username: str
    password: str
    host: str
    port: int


ENV_MAP: dict[Zone, tuple[str, str, str, str]] = {
    Zone.DATACENTER_PROXY1: (
        "BRIGHTDATA_DATACENTER_USERNAME",
        "BRIGHTDATA_DATACENTER_PASSWORD",
        "BRIGHTDATA_DATACENTER_HOST",
        "BRIGHTDATA_DATACENTER_PORT",
    ),
    Zone.RESIDENTIAL_PROXY1: (
        "BRIGHTDATA_RESIDENTIAL_USERNAME",
        "BRIGHTDATA_RESIDENTIAL_PASSWORD",
        "BRIGHTDATA_RESIDENTIAL_HOST",
        "BRIGHTDATA_RESIDENTIAL_PORT",
    ),
    Zone.LEGACY_RESIDENTIAL: (
        "BRIGHTDATA_USERNAME",
        "BRIGHTDATA_PASSWORD",
        "BRIGHTDATA_PROXY_HOST",
        "BRIGHTDATA_PROXY_PORT",
    ),
    # BrightData Unlocker zones — use BRIGHTDATA_ZONE_USERNAME/PASSWORD or BRIGHTDATA_ZONE_PASSWORD
    Zone.WEB_UNLOCKER_VN: (
        "BRIGHTDATA_ZONE_USERNAME",
        "BRIGHTDATA_ZONE_PASSWORD",
        "BRIGHTDATA_RESIDENTIAL_HOST",
        "BRIGHTDATA_RESIDENTIAL_PORT",
    ),
    Zone.SHOPEE_VN_UL: (
        "BRIGHTDATA_ZONE_USERNAME",
        "BRIGHTDATA_ZONE_PASSWORD",
        "BRIGHTDATA_RESIDENTIAL_HOST",
        "BRIGHTDATA_RESIDENTIAL_PORT",
    ),
    Zone.LAZADA_SG_WEB_UNLOCKER: (
        "BRIGHTDATA_LAZADA_SG_USERNAME",
        "BRIGHTDATA_LAZADA_SG_PASSWORD",
        "BRIGHTDATA_LAZADA_SG_HOST",
        "BRIGHTDATA_LAZADA_SG_PORT",
    ),
}

DEFAULT_USERNAME = {
    Zone.DATACENTER_PROXY1: "brd-customer-hl_3ab737be-zone-datacenter_proxy1",
    Zone.RESIDENTIAL_PROXY1: "brd-customer-hl_3ab737be-zone-residential_proxy1",
    Zone.LEGACY_RESIDENTIAL: "brd-customer-hl_3ab737be-zone-residential",
    Zone.WEB_UNLOCKER_VN: "brd-customer-hl_3ab737be-zone-web_unlocker_vn",
    Zone.SHOPEE_VN_UL: "brd-customer-hl_3ab737be-zone-shopee_vn_ul",
    Zone.LAZADA_SG_WEB_UNLOCKER: "brd-customer-hl_3ab737be-zone-lazada_sg_premium_unlocker",
}

DEFAULT_HOST = "brd.superproxy.io"

DEFAULT_PORT = {
    Zone.DATACENTER_PROXY1: 30000,
    Zone.RESIDENTIAL_PROXY1: 22225,
    Zone.LEGACY_RESIDENTIAL: 33335,
    Zone.WEB_UNLOCKER_VN: 22225,
    Zone.SHOPEE_VN_UL: 22225,
    Zone.LAZADA_SG_WEB_UNLOCKER: 22225,
}

_zone_cache: dict[Zone, ZoneConfig] = {}


def _load_zone_config(zone: Zone) -> ZoneConfig:
    """Build ZoneConfig from environment variables (cached per zone)."""
    if zone in _zone_cache:
        return _zone_cache[zone]

    user_key, pass_key, host_key, port_key = ENV_MAP[zone]
    username = os.environ.get(user_key) or DEFAULT_USERNAME[zone]
    password = os.environ.get(pass_key) or ""
    host = os.environ.get(host_key) or DEFAULT_HOST
    port = int(os.environ.get(port_key, str(DEFAULT_PORT[zone])))

    config = ZoneConfig(name=zone.value, username=username, password=password, host=host, port=port)
    _zone_cache[zone] = config
    return config


def get_zone_config(zone: Zone) -> ZoneConfig:
    """Return the full ZoneConfig for the given zone."""
    return _load_zone_config(zone)


def proxy_url(zone: Zone) -> str:
    """Build a proxy URL for use with HTTPX, aiohttp, or curl -x.

    Returns a URL like: http://user:pass@brd.superproxy.io:22225
    """
    cfg = _load_zone_config(zone)
    encoded_user = urllib.parse.quote(cfg.username, safe="")
    encoded_pass = urllib.parse.quote(cfg.password, safe="")
    return f"http://{encoded_user}:{encoded_pass}@{cfg.host}:{cfg.port}"


def proxy_config_for_httpx(zone: Zone) -> str:
    """Return proxy URL string suitable for httpx.AsyncClient(proxy=...)."""
    return proxy_url(zone)


def proxy_config_for_playwright(zone: Zone) -> dict:
    """Return a Playwright browser launch proxy config dict.

    Usage:
        browser = await playwright.chromium.launch(
            proxy=proxy_config_for_playwright(Zone.RESIDENTIAL_PROXY1)
        )
    """
    cfg = _load_zone_config(zone)
    return {
        "server": f"http://{cfg.host}:{cfg.port}",
        "username": cfg.username,
        "password": cfg.password,
    }


def proxy_config_for_requests(zone: Zone) -> dict[str, str]:
    """Return a requests-compatible proxies dict.

    Usage:
        requests.get(url, proxies=proxy_config_for_requests(Zone.DATACENTER_PROXY1))
    """
    url = proxy_url(zone)
    return {"http": url, "https": url}


def list_zones() -> list[Zone]:
    """Return all available zone identifiers."""
    return list(Zone)


def clear_cache() -> None:
    """Clear the zone config cache (useful in tests)."""
    global _zone_cache
    _zone_cache = {}
