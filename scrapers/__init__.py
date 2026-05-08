import importlib as _il

from scrapers.proxy_config import (  # noqa: E402
    Zone,
    ZoneConfig,
    get_zone_config,
    list_zones,
    proxy_config_for_httpx,
    proxy_config_for_playwright,
    proxy_config_for_requests,
    proxy_url,
)

_SCRAPERS = {
    "IKEAScraper": "ikea_sg",
    "ColdStorageScraper": "cold_storage_sg",
    "WatsonsSGScraper": "watsons_sg",
    "GuardianSGScraper": "guardian_sg",
    "UnitySGScraper": "unity_sg",
}


def __getattr__(name):
    if name in _SCRAPERS:
        mod = _il.import_module(f"scrapers.{_SCRAPERS[name]}")
        return getattr(mod, name)
    raise AttributeError(f"module scrapers has no attribute {name!r}")
