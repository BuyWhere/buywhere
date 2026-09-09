"""
Myntra India fashion scraper.

Targets Myntra catalog listing endpoints and emits canonical BuyWhere NDJSON
for ingestion or offline storage.
"""

import argparse
import json
import re
from typing import Any

from scrapers.base_scraper import BaseScraper
from scrapers.scraper_registry import register


MERCHANT_ID = "myntra_in"
SOURCE = "myntra_in"
BASE_URL = "https://www.myntra.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.myntra.com/",
}

CATEGORIES = [
    {"id": "men-tshirts", "name": "Men", "sub": "T-Shirts", "url": "https://www.myntra.com/men-tshirts", "max_pages": 300},
    {"id": "men-shirts", "name": "Men", "sub": "Shirts", "url": "https://www.myntra.com/men-shirts", "max_pages": 300},
    {"id": "men-jeans", "name": "Men", "sub": "Jeans", "url": "https://www.myntra.com/men-jeans", "max_pages": 250},
    {"id": "men-shoes", "name": "Men", "sub": "Shoes", "url": "https://www.myntra.com/men-shoes", "max_pages": 250},
    {"id": "women-kurtas-kurtis-suits", "name": "Women", "sub": "Ethnic Wear", "url": "https://www.myntra.com/women-kurtas-kurtis-suits", "max_pages": 300},
    {"id": "women-dresses", "name": "Women", "sub": "Dresses", "url": "https://www.myntra.com/women-dresses", "max_pages": 300},
    {"id": "women-tops", "name": "Women", "sub": "Tops", "url": "https://www.myntra.com/women-tops", "max_pages": 250},
    {"id": "women-shoes", "name": "Women", "sub": "Shoes", "url": "https://www.myntra.com/women-shoes", "max_pages": 250},
    {"id": "kids", "name": "Kids", "sub": "Fashion", "url": "https://www.myntra.com/kids", "max_pages": 250},
]

MAINTENANCE_MARKERS = (
    "site maintenance",
    "oops! something went wrong",
    "please contact your administrator",
)


@register("myntra_in")
class MyntraINScraper(BaseScraper):
    MERCHANT_ID = MERCHANT_ID
    SOURCE = SOURCE
    BASE_URL = BASE_URL
    DEFAULT_HEADERS = HEADERS

    def get_categories(self) -> list[dict]:
        return CATEGORIES

    async def fetch_page(self, category: dict, page: int) -> list[dict]:
        slug = category["id"]
        url = f"{BASE_URL}/gateway/v2/search/{slug}"
        params = {
            "p": page,
            "rows": 50,
            "o": (page - 1) * 50,
            "plaEnabled": "false",
        }
        resp = await self._get_with_retry(url, params=params)
        if resp is None:
            return []

        content_type = resp.headers.get("content-type", "").lower()
        text = resp.text.strip()

        if "html" in content_type or self._is_maintenance_response(text):
            self.log.page_empty(url, "Myntra returned maintenance HTML instead of product data")
            return []

        try:
            payload = resp.json()
        except json.JSONDecodeError:
            self.log.parse_error(url, "Myntra search response was not valid JSON")
            return []

        products = self._extract_products_from_payload(payload)
        if not products:
            self.log.page_empty(url, "Myntra JSON response contained no products")
        return products

    def transform(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            sku = str(
                raw.get("id")
                or raw.get("productId")
                or raw.get("sku")
                or raw.get("styleId")
                or ""
            ).strip()
            if not sku:
                return None

            title = (
                raw.get("productName")
                or raw.get("product")
                or raw.get("title")
                or raw.get("name")
                or ""
            ).strip()
            if not title:
                return None

            discounted_price = self._parse_price(
                raw.get("discountedPrice")
                or raw.get("discounted_price")
                or raw.get("sellingPrice")
                or raw.get("price")
            )
            original_price = self._parse_price(raw.get("price") or raw.get("mrp") or raw.get("originalPrice"))
            price = discounted_price or original_price
            if price <= 0:
                return None
            if original_price <= 0:
                original_price = price

            product_url = self._normalize_product_url(
                raw.get("landingPageUrl")
                or raw.get("productUrl")
                or raw.get("url")
                or ""
            )
            if not product_url:
                return None

            image_url = self._extract_image_url(raw)
            brand = (raw.get("brand") or raw.get("brandName") or "").strip()

            category_name = (raw.get("gender") or category["name"] or "").strip() or category["name"]
            subcategory = (
                raw.get("articleType")
                or raw.get("subCategory")
                or raw.get("subcategory")
                or category["sub"]
            )
            category_path = [category_name, subcategory]

            rating = self._parse_float(raw.get("rating") or raw.get("averageRating"))
            review_count = self._parse_int(
                raw.get("ratingCount")
                or raw.get("reviewCount")
                or raw.get("ratingCounts")
                or raw.get("reviews")
            )
            discount_pct = self._calculate_discount_pct(price, original_price)

            metadata = {
                "original_price": original_price,
                "discount_pct": discount_pct,
                "rating": rating,
                "review_count": review_count,
                "gender": raw.get("gender"),
                "primary_color": raw.get("baseColour") or raw.get("color"),
                "sizes": self._extract_sizes(raw),
                "article_type": raw.get("articleType"),
                "season": raw.get("season"),
                "inventory": self._parse_int(raw.get("inventory")),
                "search_rank": self._parse_int(raw.get("position")),
            }

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": (raw.get("additionalInfo") or raw.get("description") or "").strip(),
                "price": price,
                "currency": "INR",
                "url": product_url,
                "image_url": image_url,
                "category": category_name,
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "metadata": {k: v for k, v in metadata.items() if v not in (None, "", [], {})},
            }
        except Exception:
            return None

    @staticmethod
    def _is_maintenance_response(text: str) -> bool:
        lowered = text.lower()
        return any(marker in lowered for marker in MAINTENANCE_MARKERS)

    @staticmethod
    def _extract_products_from_payload(payload: dict[str, Any]) -> list[dict]:
        candidates = (
            payload.get("products"),
            payload.get("data", {}).get("products") if isinstance(payload.get("data"), dict) else None,
            payload.get("searchData", {}).get("results", {}).get("products") if isinstance(payload.get("searchData"), dict) else None,
            payload.get("searchData", {}).get("results") if isinstance(payload.get("searchData"), dict) else None,
            payload.get("results"),
            payload.get("items"),
        )
        for candidate in candidates:
            if isinstance(candidate, list):
                return [item for item in candidate if isinstance(item, dict)]
        return []

    @staticmethod
    def _parse_price(value: Any) -> float:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        cleaned = str(value).strip()
        if not cleaned:
            return 0.0
        cleaned = (
            cleaned.replace("Rs.", "")
            .replace("Rs", "")
            .replace("MRP", "")
            .replace("INR", "")
            .replace(",", "")
            .strip()
        )
        match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
        return float(match.group(0)) if match else 0.0

    @staticmethod
    def _parse_float(value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(str(value).strip())
        except ValueError:
            return None

    @staticmethod
    def _parse_int(value: Any) -> int | None:
        if value in (None, ""):
            return None
        match = re.search(r"\d+", str(value))
        return int(match.group(0)) if match else None

    @staticmethod
    def _calculate_discount_pct(price: float, original_price: float) -> int:
        if original_price <= 0 or price <= 0 or price >= original_price:
            return 0
        return round(((original_price - price) / original_price) * 100)

    @staticmethod
    def _normalize_product_url(value: str) -> str:
        cleaned = str(value or "").strip()
        if not cleaned:
            return ""
        if cleaned.startswith("//"):
            return f"https:{cleaned}"
        if cleaned.startswith("http://") or cleaned.startswith("https://"):
            return cleaned
        if not cleaned.startswith("/"):
            cleaned = f"/{cleaned}"
        return f"{BASE_URL}{cleaned}"

    @staticmethod
    def _extract_image_url(raw: dict[str, Any]) -> str:
        direct_keys = (
            raw.get("searchImage"),
            raw.get("defaultImage"),
            raw.get("imageURL"),
            raw.get("imageUrl"),
            raw.get("image"),
        )
        for value in direct_keys:
            if isinstance(value, str) and value.strip():
                return value.strip()

        images = raw.get("images") or raw.get("media") or raw.get("imageURLs") or []
        if isinstance(images, list):
            for item in images:
                if isinstance(item, str) and item.strip():
                    return item.strip()
                if isinstance(item, dict):
                    candidate = item.get("src") or item.get("url") or item.get("secureUrl")
                    if candidate:
                        return str(candidate).strip()
        return ""

    @staticmethod
    def _extract_sizes(raw: dict[str, Any]) -> list[str]:
        size_values = raw.get("sizes") or raw.get("availableSizes") or raw.get("sizeOptions") or []
        sizes: list[str] = []
        if isinstance(size_values, list):
            for item in size_values:
                if isinstance(item, str) and item.strip():
                    sizes.append(item.strip())
                elif isinstance(item, dict):
                    candidate = item.get("label") or item.get("size") or item.get("name")
                    if candidate:
                        sizes.append(str(candidate).strip())
        return sizes

    @classmethod
    def add_cli_args(cls, parser: argparse.ArgumentParser) -> None:
        super().add_cli_args(parser)
        parser.description = "Myntra India fashion scraper"


async def main() -> None:
    from scrapers.base_scraper import run_scraper

    await run_scraper(MyntraINScraper)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
