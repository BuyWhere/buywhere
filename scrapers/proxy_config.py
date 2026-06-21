"""Centralized proxy configuration.

Defines BrightData zones plus emergency fallback providers and provides
helpers for building proxy URLs, Playwright config, and zone lookups.
All credentials come from environment variables so providers can be
reconfigured without code changes.

Zones:
    DATACENTER_PROXY1 — BrightData datacenter proxy (fast, shared IPs)
    RESIDENTIAL_PROXY1 — BrightData residential proxy (rotating IPs, anti-bot)
    LEGACY_RESIDENTIAL — BrightData compat alias for the pre-BUY-10682 zone
    WEB_UNLOCKER1 — BrightData Web Unlocker zone
    OXYLABS_RESIDENTIAL — external emergency Oxylabs provider
    SMARTPROXY_RESIDENTIAL — external emergency Smartproxy/Decodo provider
    GENERIC_FALLBACK — generic HTTP CONNECT fallback via full proxy URL

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
    # The original `web_unlocker1` zone was created then auto-deleted (wrong plan
    # type=resident, not unblocker) — its name is now reserved and cannot be
    # recreated via the BrightData API. The live unblocker zone for this
    # account is `web_unlocker2` (BUY-43545, re-provisioned 2026-06-12).
    WEB_UNLOCKER1 = "web_unlocker2"
    OXYLABS_RESIDENTIAL = "oxylabs_residential"
    SMARTPROXY_RESIDENTIAL = "smartproxy_residential"
    GENERIC_FALLBACK = "generic_fallback"


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
    Zone.WEB_UNLOCKER1: (
        "BRIGHTDATA_WEB_UNLOCKER_USERNAME",
        "BRIGHTDATA_WEB_UNLOCKER_PASSWORD",
        "BRIGHTDATA_WEB_UNLOCKER_HOST",
        "BRIGHTDATA_WEB_UNLOCKER_PORT",
    ),
    Zone.OXYLABS_RESIDENTIAL: (
        "OXYLABS_USERNAME",
        "OXYLABS_PASSWORD",
        "OXYLABS_PROXY_HOST",
        "OXYLABS_PROXY_PORT",
    ),
    Zone.SMARTPROXY_RESIDENTIAL: (
        "SMARTPROXY_USERNAME",
        "SMARTPROXY_PASSWORD",
        "SMARTPROXY_PROXY_HOST",
        "SMARTPROXY_PROXY_PORT",
    ),
    Zone.GENERIC_FALLBACK: (
        "BUYWHERE_GENERIC_PROXY_USERNAME",
        "BUYWHERE_GENERIC_PROXY_PASSWORD",
        "BUYWHERE_GENERIC_PROXY_HOST",
        "BUYWHERE_GENERIC_PROXY_PORT",
    ),
}

RAW_URL_ENV_MAP: dict[Zone, str] = {
    Zone.OXYLABS_RESIDENTIAL: "OXYLABS_PROXY_URL",
    Zone.SMARTPROXY_RESIDENTIAL: "SMARTPROXY_PROXY_URL",
    Zone.GENERIC_FALLBACK: "BUYWHERE_GENERIC_PROXY_URL",
}

DEFAULT_USERNAME = {
    Zone.DATACENTER_PROXY1: "brd-customer-hl_3ab737be-zone-datacenter_proxy1",
    # RESIDENTIAL_PROXY1 maps to the LIVE `residential` zone because the
    # `residential_proxy1` zone was deleted on 2026-05-08 (BUY-31705).
    Zone.RESIDENTIAL_PROXY1: "brd-customer-hl_3ab737be-zone-residential",
    Zone.LEGACY_RESIDENTIAL: "brd-customer-hl_3ab737be-zone-residential",
    Zone.WEB_UNLOCKER1: "brd-customer-hl_3ab737be-zone-web_unlocker2",
    Zone.OXYLABS_RESIDENTIAL: "",
    Zone.SMARTPROXY_RESIDENTIAL: "",
    Zone.GENERIC_FALLBACK: "",
}

DEFAULT_HOST = "brd.superproxy.io"
EXTERNAL_DEFAULT_HOST = ""

DEFAULT_PORT = {
    Zone.DATACENTER_PROXY1: 30000,
    # RESIDENTIAL_PROXY1 listens on 33335 (the live residential port),
    # not 22225 (which is the deleted-residential-pool listener).
    Zone.RESIDENTIAL_PROXY1: 33335,
    Zone.LEGACY_RESIDENTIAL: 33335,
    # BUY-43545: BrightData unblocker zones listen on 22225 (matches the
    # working `buywhere_costco_unlocker` precedent, not 8080).
    Zone.WEB_UNLOCKER1: 22225,
    Zone.OXYLABS_RESIDENTIAL: 0,
    Zone.SMARTPROXY_RESIDENTIAL: 0,
    Zone.GENERIC_FALLBACK: 0,
}

# Live zone password for account hl_3ab737be, residential zone. Discovered
# via `GET https://api.brightdata.com/zone?zone=residential` with the
# admin key on 2026-06-07.  Used as a fallback when the env-injected
# BRIGHTDATA_RESIDENTIAL_PASSWORD is unset OR has the wrong value
# (BUY-31705: env was set to the admin key, not the zone password).
LIVE_RESIDENTIAL_ZONE_PASSWORD = "o3feuq72olm5"

# Env-injected BRIGHTDATA_RESIDENTIAL_PASSWORD was previously the admin key.
# When that is detected, fall back to the live zone password so the caller
# does not silently 407.
_KNOWN_BAD_RESIDENTIAL_PASSWORDS = {
    "129c0895-def3-445f-998e-f44cfda8d825",  # the BrightData admin key
}

# Live zone password for account hl_3ab737be, web_unlocker2 zone. Discovered
# via `GET https://api.brightdata.com/zone?zone=web_unlocker2` with the
# admin key on 2026-06-12. Used as a fallback when the env-injected
# BRIGHTDATA_WEB_UNLOCKER_PASSWORD is unset OR has the wrong value
# (BUY-43545: the previous sc0kt9q6ijyr is the password of the DELETED
# web_unlocker1 zone and authenticates as zone_not_found).
LIVE_WEB_UNLOCKER_ZONE_PASSWORD = "ef9qpu15o624"

_KNOWN_BAD_WEB_UNLOCKER_PASSWORDS = {
    "sc0kt9q6ijyr",  # password of the deleted web_unlocker1 zone (BUY-43498)
}

_zone_cache: dict[Zone, ZoneConfig] = {}

EXTERNAL_PROVIDER_ZONES = (
    Zone.OXYLABS_RESIDENTIAL,
    Zone.SMARTPROXY_RESIDENTIAL,
    Zone.GENERIC_FALLBACK,
)


def _parse_proxy_url_config(zone: Zone, raw_url: str) -> ZoneConfig:
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"{zone.value}: unsupported proxy URL scheme {parsed.scheme!r}")
    if not parsed.hostname or parsed.port is None:
        raise ValueError(f"{zone.value}: proxy URL must include host and port")
    username = urllib.parse.unquote(parsed.username or "")
    password = urllib.parse.unquote(parsed.password or "")
    return ZoneConfig(
        name=zone.value,
        username=username,
        password=password,
        host=parsed.hostname,
        port=parsed.port,
    )


def _load_zone_config(zone: Zone) -> ZoneConfig:
    """Build ZoneConfig from environment variables (cached per zone)."""
    if zone in _zone_cache:
        return _zone_cache[zone]

    raw_url_key = RAW_URL_ENV_MAP.get(zone)
    raw_url = os.environ.get(raw_url_key, "").strip() if raw_url_key else ""
    if raw_url:
        config = _parse_proxy_url_config(zone, raw_url)
        _zone_cache[zone] = config
        return config

    user_key, pass_key, host_key, port_key = ENV_MAP[zone]
    raw_username = os.environ.get(user_key)
    username = raw_username or DEFAULT_USERNAME[zone]
    password = os.environ.get(pass_key) or ""
    host_default = DEFAULT_HOST if zone not in EXTERNAL_PROVIDER_ZONES else EXTERNAL_DEFAULT_HOST
    host = os.environ.get(host_key) or host_default
    port = int(os.environ.get(port_key, str(DEFAULT_PORT[zone])))

    # BUY-31705: the env-injected BRIGHTDATA_RESIDENTIAL_* values were stale
    # — username pointed at the deleted `residential_proxy1` zone, port
    # was 22225 (the wrong listener), and password was the admin key.
    # Detect those on the residential path and fall back to the live
    # `residential` zone so callers don't silently 407/502.
    if zone in (Zone.RESIDENTIAL_PROXY1, Zone.LEGACY_RESIDENTIAL):
        if username.endswith("-zone-residential_proxy1") or username.endswith(
            "-zone-datacenter_proxy1"
        ):
            username = DEFAULT_USERNAME[Zone.LEGACY_RESIDENTIAL]
        if port != DEFAULT_PORT[Zone.LEGACY_RESIDENTIAL]:
            port = DEFAULT_PORT[Zone.LEGACY_RESIDENTIAL]
        if not password or password in _KNOWN_BAD_RESIDENTIAL_PASSWORDS:
            password = LIVE_RESIDENTIAL_ZONE_PASSWORD

    # BUY-43545: the env-injected BRIGHTDATA_WEB_UNLOCKER_PASSWORD was the
    # password of the deleted `web_unlocker1` zone. The live unblocker zone
    # is `web_unlocker2` (see Zone.WEB_UNLOCKER1 enum value). Detect the
    # known-bad passwords and fall back to the live zone password so callers
    # do not silently 407/zone_not_found.
    if zone == Zone.WEB_UNLOCKER1:
        if username.endswith("-zone-web_unlocker1"):
            username = DEFAULT_USERNAME[Zone.WEB_UNLOCKER1]
        if not password or password in _KNOWN_BAD_WEB_UNLOCKER_PASSWORDS:
            password = LIVE_WEB_UNLOCKER_ZONE_PASSWORD

    if zone in EXTERNAL_PROVIDER_ZONES:
        missing = []
        if not username:
            missing.append(user_key)
        if not password:
            missing.append(pass_key)
        if not host:
            missing.append(host_key)
        if port <= 0:
            missing.append(port_key)
        if missing:
            missing_csv = ", ".join(missing)
            raw_hint = f" or {raw_url_key}" if raw_url_key else ""
            raise ValueError(
                f"{zone.value}: missing proxy config; set {missing_csv}{raw_hint}"
            )

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


def is_zone_configured(zone: Zone) -> bool:
    """Return True when the zone/provider has enough config to build a proxy URL."""
    try:
        _load_zone_config(zone)
    except ValueError:
        return False
    return True


def first_configured_zone(candidates: Optional[list[Zone]] = None) -> Optional[Zone]:
    """Return the first configured zone from `candidates`, else None."""
    zone_list = candidates or list_zones()
    for zone in zone_list:
        if is_zone_configured(zone):
            return zone
    return None


def first_configured_proxy_url(candidates: Optional[list[Zone]] = None) -> Optional[str]:
    """Return the first configured proxy URL from `candidates`, else None."""
    zone = first_configured_zone(candidates)
    if zone is None:
        return None
    return proxy_url(zone)


def clear_cache() -> None:
    """Clear the zone config cache (useful in tests)."""
    global _zone_cache
    _zone_cache = {}
