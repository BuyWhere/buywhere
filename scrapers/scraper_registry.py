"""Scraper registry for BuyWhere scrapers."""

from typing import Type

_REGISTRY: dict[str, Type] = {}


def register(name: str):
    """Decorator to register a scraper class."""

    def decorator(cls: Type) -> Type:
        _REGISTRY[name] = cls
        return cls

    return decorator


def get_scraper(name: str) -> Type | None:
    """Get a scraper class by name."""
    return _REGISTRY.get(name)


def list_scrapers() -> list[str]:
    """List all registered scraper names."""
    return list(_REGISTRY.keys())
