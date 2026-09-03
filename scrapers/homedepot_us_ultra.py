"""
Home Depot US product scraper using ScraperAPI ultra_premium.

Target: 200K+ home improvement products.
Tag: region=us, country_code=US, currency=USD

Key finding: Home Depot requires ultra_premium=true on ScraperAPI.
Without it, requests return 500 error.

Usage:
    python3 homedepot_us_ultra.py --scrape-only --target 200000
"""

import argparse
import asyncio
import json
import os
import re
import time
from typing import Any

import httpx

SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY", "0832602ba87752788b2cd9ab6cef34df")
MERCHANT_ID = "homedepot_us"
SOURCE = "homedepot_us"
BASE_URL = "https://www.homedepot.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

CATEGORIES = [
    {"id": "tools-power-tools", "name": "Tools", "sub": "Power Tools", "path": "/s/power+tools?page={page}"},
    {"id": "tools-cordless-drills", "name": "Tools", "sub": "Cordless Drills", "path": "/s/cordless+drill?page={page}"},
    {"id": "tools-circular-saws", "name": "Tools", "sub": "Circular Saws", "path": "/s/circular+saw?page={page}"},
    {"id": "tools-hand-tools", "name": "Tools", "sub": "Hand Tools", "path": "/s/hand+tools?page={page}"},
    {"id": "tools-screwdrivers", "name": "Tools", "sub": "Screwdrivers", "path": "/s/screwdriver?page={page}"},
    {"id": "tools-hammers", "name": "Tools", "sub": "Hammers", "path": "/s/hammer?page={page}"},
    {"id": "tools-wrench-sets", "name": "Tools", "sub": "Wrench Sets", "path": "/s/wrench+set?page={page}"},
    {"id": "tools-sanders", "name": "Tools", "sub": "Sanders", "path": "/s/sander?page={page}"},
    {"id": "tools-nail-guns", "name": "Tools", "sub": "Nail Guns", "path": "/s/nail+gun?page={page}"},
    {"id": "tools-air-compressors", "name": "Tools", "sub": "Air Compressors", "path": "/s/air+compressor?page={page}"},
    {"id": "tools-routers", "name": "Tools", "sub": "Routers", "path": "/s/router+tool?page={page}"},
    {"id": "tools-table-saws", "name": "Tools", "sub": "Table Saws", "path": "/s/table+saw?page={page}"},
    {"id": "tools-miter-saws", "name": "Tools", "sub": "Miter Saws", "path": "/s/miter+saw?page={page}"},
    {"id": "hardware-screws", "name": "Hardware", "sub": "Screws", "path": "/s/screws?page={page}"},
    {"id": "hardware-nails", "name": "Hardware", "sub": "Nails", "path": "/s/nails?page={page}"},
    {"id": "hardware-bolts", "name": "Hardware", "sub": "Bolts", "path": "/s/bolts?page={page}"},
    {"id": "hardware-locks", "name": "Hardware", "sub": "Locks & Security", "path": "/s/door+lock?page={page}"},
    {"id": "hardware-shelves", "name": "Hardware", "sub": "Shelves & Brackets", "path": "/s/shelf+bracket?page={page}"},
    {"id": "hardware-hinges", "name": "Hardware", "sub": "Hinges", "path": "/s/hinges?page={page}"},
    {"id": "hardware-hooks", "name": "Hardware", "sub": "Hooks", "path": "/s/wall+hooks?page={page}"},
    {"id": "building-lumber", "name": "Building Materials", "sub": "Lumber", "path": "/s/lumber?page={page}"},
    {"id": "building-plywood", "name": "Building Materials", "sub": "Plywood", "path": "/s/plywood?page={page}"},
    {"id": "building-drywall", "name": "Building Materials", "sub": "Drywall", "path": "/s/drywall?page={page}"},
    {"id": "building-cement", "name": "Building Materials", "sub": "Cement & Concrete", "path": "/s/cement?page={page}"},
    {"id": "building-insulation", "name": "Building Materials", "sub": "Insulation", "path": "/s/insulation?page={page}"},
    {"id": "building-roofing", "name": "Building Materials", "sub": "Roofing", "path": "/s/roofing?page={page}"},
    {"id": "paint-interior", "name": "Paint", "sub": "Interior Paint", "path": "/s/interior+paint?page={page}"},
    {"id": "paint-exterior", "name": "Paint", "sub": "Exterior Paint", "path": "/s/exterior+paint?page={page}"},
    {"id": "paint-stains", "name": "Paint", "sub": "Stains & Sealers", "path": "/s/wood+stain?page={page}"},
    {"id": "paint-supplies", "name": "Paint", "sub": "Paint Supplies", "path": "/s/paint+supplies?page={page}"},
    {"id": "paint-sprayers", "name": "Paint", "sub": "Paint Sprayers", "path": "/s/paint+sprayer?page={page}"},
    {"id": "plumbing-water-heaters", "name": "Plumbing", "sub": "Water Heaters", "path": "/s/water+heater?page={page}"},
    {"id": "plumbing-faucets", "name": "Plumbing", "sub": "Kitchen Faucets", "path": "/s/kitchen+faucet?page={page}"},
    {"id": "plumbing-bathroom-faucets", "name": "Plumbing", "sub": "Bathroom Faucets", "path": "/s/bathroom+faucet?page={page}"},
    {"id": "plumbing-pipes", "name": "Plumbing", "sub": "Pipes & Fittings", "path": "/s/pvc+pipe?page={page}"},
    {"id": "plumbing-toilets", "name": "Plumbing", "sub": "Toilets", "path": "/s/toilet?page={page}"},
    {"id": "plumbing-sinks", "name": "Plumbing", "sub": "Kitchen Sinks", "path": "/s/kitchen+sink?page={page}"},
    {"id": "plumbing-pumps", "name": "Plumbing", "sub": "Sump Pumps", "path": "/s/sump+pump?page={page}"},
    {"id": "plumbing-garbage-disposals", "name": "Plumbing", "sub": "Garbage Disposals", "path": "/s/garbage+disposal?page={page}"},
    {"id": "electrical-light-fixtures", "name": "Electrical", "sub": "Light Fixtures", "path": "/s/light+fixture?page={page}"},
    {"id": "electrical-ceiling-fans", "name": "Electrical", "sub": "Ceiling Fans", "path": "/s/ceiling+fan?page={page}"},
    {"id": "electrical-outlets", "name": "Electrical", "sub": "Outlets & Switches", "path": "/s/electrical+outlet?page={page}"},
    {"id": "electrical-circuit-breakers", "name": "Electrical", "sub": "Circuit Breakers", "path": "/s/circuit+breaker?page={page}"},
    {"id": "electrical-wire", "name": "Electrical", "sub": "Wire & Cable", "path": "/s/electrical+wire?page={page}"},
    {"id": "electrical-extension-cords", "name": "Electrical", "sub": "Extension Cords", "path": "/s/extension+cord?page={page}"},
    {"id": "electrical-flashlights", "name": "Electrical", "sub": "Flashlights", "path": "/s/flashlight?page={page}"},
    {"id": "flooring-hardwood", "name": "Flooring", "sub": "Hardwood Flooring", "path": "/s/hardwood+flooring?page={page}"},
    {"id": "flooring-laminate", "name": "Flooring", "sub": "Laminate Flooring", "path": "/s/laminate+flooring?page={page}"},
    {"id": "flooring-tile", "name": "Flooring", "sub": "Tile Flooring", "path": "/s/tile+flooring?page={page}"},
    {"id": "flooring-vinyl", "name": "Flooring", "sub": "Vinyl Flooring", "path": "/s/vinyl+plank+flooring?page={page}"},
    {"id": "flooring-carpet", "name": "Flooring", "sub": "Carpet", "path": "/s/carpet?page={page}"},
    {"id": "flooring-area-rugs", "name": "Flooring", "sub": "Area Rugs", "path": "/s/area+rug?page={page}"},
    {"id": "flooring-floor-installation", "name": "Flooring", "sub": "Floor Installation", "path": "/s/floor+installation?page={page}"},
    {"id": "hvac-air-conditioners", "name": "HVAC", "sub": "Air Conditioners", "path": "/s/air+conditioner?page={page}"},
    {"id": "hvac-furnaces", "name": "HVAC", "sub": "Furnaces", "path": "/s/furnace?page={page}"},
    {"id": "hvac-thermostats", "name": "HVAC", "sub": "Thermostats", "path": "/s/thermostat?page={page}"},
    {"id": "hvac-humidifiers", "name": "HVAC", "sub": "Humidifiers", "path": "/s/search?q=humidifier&page={page}"},
    {"id": "hvac-dehumidifiers", "name": "HVAC", "sub": "Dehumidifiers", "path": "/s/search?q=dehumidifier&page={page}"},
    {"id": "hvac-vents", "name": "HVAC", "sub": "Vents & Ductwork", "path": "/s/search?q=air+vents&page={page}"},
    {"id": "storage-shelving", "name": "Storage & Organization", "sub": "Shelving", "path": "/s/search?q=shelving+unit&page={page}"},
    {"id": "storage-garage", "name": "Storage & Organization", "sub": "Garage Storage", "path": "/s/search?q=garage+storage&page={page}"},
    {"id": "storage-closet", "name": "Storage & Organization", "sub": "Closet Organizers", "path": "/s/search?q=closet+organizer&page={page}"},
    {"id": "storage-sheds", "name": "Storage & Organization", "sub": "Outdoor Sheds", "path": "/s/search?q=storage+shed&page={page}"},
    {"id": "storage-containers", "name": "Storage & Organization", "sub": "Storage Containers", "path": "/s/search?q=storage+container&page={page}"},
    {"id": "kitchen-cabinets", "name": "Kitchen", "sub": "Kitchen Cabinets", "path": "/s/search?q=kitchen+cabinet&page={page}"},
    {"id": "kitchen-countertops", "name": "Kitchen", "sub": "Countertops", "path": "/s/search?q=countertop&page={page}"},
    {"id": "kitchen-sinks", "name": "Kitchen", "sub": "Kitchen Sinks", "path": "/s/search?q=undermount+sink&page={page}"},
    {"id": "kitchen-appliances", "name": "Kitchen", "sub": "Appliances", "path": "/s/search?q=kitchen+appliance&page={page}"},
    {"id": "kitchen-microwaves", "name": "Kitchen", "sub": "Microwaves", "path": "/s/search?q=microwave&page={page}"},
    {"id": "kitchen-dishwashers", "name": "Kitchen", "sub": "Dishwashers", "path": "/s/search?q=dishwasher&page={page}"},
    {"id": "kitchen-refrigerators", "name": "Kitchen", "sub": "Refrigerators", "path": "/s/search?q=refrigerator&page={page}"},
    {"id": "kitchen-ranges", "name": "Kitchen", "sub": "Ranges & Stoves", "path": "/s/search?q=gas+range&page={page}"},
    {"id": "bathroom-vanity", "name": "Bathroom", "sub": "Bathroom Vanities", "path": "/s/search?q=bathroom+vanity&page={page}"},
    {"id": "bathroom-toilets", "name": "Bathroom", "sub": "Toilets", "path": "/s/search?q=toilet&page={page}"},
    {"id": "bathroom-shower", "name": "Bathroom", "sub": "Shower & Bathtub", "path": "/s/search?q=shower+bathtub&page={page}"},
    {"id": "bathroom-accessories", "name": "Bathroom", "sub": "Bathroom Accessories", "path": "/s/search?q=bathroom+accessories&page={page}"},
    {"id": "doors-exterior", "name": "Doors & Windows", "sub": "Exterior Doors", "path": "/s/search?q=exterior+door&page={page}"},
    {"id": "doors-interior", "name": "Doors & Windows", "sub": "Interior Doors", "path": "/s/search?q=interior+door&page={page}"},
    {"id": "doors-windows", "name": "Doors & Windows", "sub": "Windows", "path": "/s/search?q=window&page={page}"},
    {"id": "doors-skylights", "name": "Doors & Windows", "sub": "Skylights", "path": "/s/search?q=skylight&page={page}"},
    {"id": "doors-garage", "name": "Doors & Windows", "sub": "Garage Doors", "path": "/s/search?q=garage+door&page={page}"},
    {"id": "garden-lawn-mowers", "name": "Garden & Outdoor", "sub": "Lawn Mowers", "path": "/s/search?q=lawn+mower&page={page}"},
    {"id": "garden-tractors", "name": "Garden & Outdoor", "sub": "Tractors & Riders", "path": "/s/search?q=lawn+tractor&page={page}"},
    {"id": "garden-trimmers", "name": "Garden & Outdoor", "sub": "String Trimmers", "path": "/s/search?q=string+trimmer&page={page}"},
    {"id": "garden-chainsaws", "name": "Garden & Outdoor", "sub": "Chainsaws", "path": "/s/search?q=chainsaw&page={page}"},
    {"id": "garden-leaf-blowers", "name": "Garden & Outdoor", "sub": "Leaf Blowers", "path": "/s/search?q=leaf+blower&page={page}"},
    {"id": "garden-snow-blowers", "name": "Garden & Outdoor", "sub": "Snow Blowers", "path": "/s/search?q=snow+blower&page={page}"},
    {"id": "garden-patio-furniture", "name": "Garden & Outdoor", "sub": "Patio Furniture", "path": "/s/search?q=patio+furniture&page={page}"},
    {"id": "garden-patio-sets", "name": "Garden & Outdoor", "sub": "Patio Sets", "path": "/s/search?q=patio+set&page={page}"},
    {"id": "garden-grills", "name": "Garden & Outdoor", "sub": "Grills", "path": "/s/search?q=gas+grill&page={page}"},
    {"id": "garden-plants", "name": "Garden & Outdoor", "sub": "Plants & Flowers", "path": "/s/search?q=plants&page={page}"},
    {"id": "garden-seeds", "name": "Garden & Outdoor", "sub": "Seeds & Bulbs", "path": "/s/search?q=seeds&page={page}"},
    {"id": "garden-soil", "name": "Garden & Outdoor", "sub": "Soil & Mulch", "path": "/s/search?q=mulch&page={page}"},
    {"id": "garden-garden-tools", "name": "Garden & Outdoor", "sub": "Garden Tools", "path": "/s/search?q=garden+tools&page={page}"},
    {"id": "garden-hoses", "name": "Garden & Outdoor", "sub": "Garden Hoses", "path": "/s/search?q=garden+hose&page={page}"},
    {"id": "garden-sprinklers", "name": "Garden & Outdoor", "sub": "Sprinklers", "path": "/s/search?q=sprinkler&page={page}"},
    {"id": "appliances-washers", "name": "Appliances", "sub": "Washers", "path": "/s/search?q=washing+machine&page={page}"},
    {"id": "appliances-dryers", "name": "Appliances", "sub": "Dryers", "path": "/s/search?q=dryer&page={page}"},
    {"id": "appliances-refrigerators", "name": "Appliances", "sub": "Refrigerators", "path": "/s/search?q=refrigerator&page={page}"},
    {"id": "appliances-ranges", "name": "Appliances", "sub": "Ranges", "path": "/s/search?q=electric+range&page={page}"},
    {"id": "appliances-dishwashers", "name": "Appliances", "sub": "Dishwashers", "path": "/s/search?q=dishwasher&page={page}"},
    {"id": "appliances-microwaves", "name": "Appliances", "sub": "Microwaves", "path": "/s/search?q=over+the+range+microwave&page={page}"},
    {"id": "appliances-hoods", "name": "Appliances", "sub": "Range Hoods", "path": "/s/search?q=range+hood&page={page}"},
    {"id": "appliances-ice-makers", "name": "Appliances", "sub": "Ice Makers", "path": "/s/search?q=ice+maker&page={page}"},
    {"id": "cleaning-vacuums", "name": "Cleaning", "sub": "Vacuums", "path": "/s/search?q=vacuum+cleaner&page={page}"},
    {"id": "cleaning-mops", "name": "Cleaning", "sub": "Mops & Brooms", "path": "/s/search?q=mop&page={page}"},
    {"id": "cleaning-pressure-washers", "name": "Cleaning", "sub": "Pressure Washers", "path": "/s/search?q=pressure+washer&page={page}"},
    {"id": "cleaning-air-fresheners", "name": "Cleaning", "sub": "Air Fresheners", "path": "/s/search?q=air+freshener&page={page}"},
    {"id": "safety-ppe", "name": "Safety", "sub": "Workwear & PPE", "path": "/s/search?q=work+gloves&page={page}"},
    {"id": "safety-fire-safety", "name": "Safety", "sub": "Fire Safety", "path": "/s/search?q=fire+extinguisher&page={page}"},
    {"id": "safety-security", "name": "Safety", "sub": "Home Security", "path": "/s/search?q=home+security&page={page}"},
    {"id": "lighting-indoor", "name": "Lighting", "sub": "Indoor Lighting", "path": "/s/search?q=indoor+lighting&page={page}"},
    {"id": "lighting-outdoor", "name": "Lighting", "sub": "Outdoor Lighting", "path": "/s/search?q=outdoor+lighting&page={page}"},
    {"id": "lighting-fans", "name": "Lighting", "sub": "Ceiling Fans", "path": "/s/search?q=ceiling+fan&page={page}"},
    {"id": "lighting-lamps", "name": "Lighting", "sub": "Lamps & Shades", "path": "/s/search?q=lamp&page={page}"},
    {"id": "lighting-bulbs", "name": "Lighting", "sub": "Light Bulbs", "path": "/s/search?q=light+bulbs&page={page}"},
]


class HomeDepotUSUltraScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.5,
        data_dir: str = "/home/paperclip/buywhere-api/data/homedepot_us",
        target: int = 200000,
        scrape_only: bool = False,
        scraperapi_key: str | None = None,
        concurrency: int = 8,
        max_pages_per_category: int = 100,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
        self.target = target
        self.scrape_only = scrape_only
        self.scraperapi_key = scraperapi_key or SCRAPERAPI_KEY
        self.concurrency = concurrency
        self.max_pages_per_category = max_pages_per_category
        self.client = httpx.AsyncClient(timeout=120.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._session_start = time.strftime("%Y%m%d_%H%M%S")
        self._semaphore = asyncio.Semaphore(concurrency)
        self._seen_ids: set[str] = set()
        self._category_stats: dict[str, dict[str, int]] = {}
        self._output_file = os.path.join(self.data_dir, f"homedepot_us_{self._session_start}.ndjson")

    async def close(self) -> None:
        await self.client.aclose()

    def _write_products_to_file(self, products: list[dict]) -> None:
        if not products:
            return
        with open(self._output_file, "a", encoding="utf-8") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

    async def _fetch_with_scraperapi(self, url: str, retries: int = 3) -> str | None:
        for attempt in range(retries):
            proxy_url = f"http://api.scraperapi.com?api_key={self.scraperapi_key}&url={url}&ultra_premium=true"
            try:
                resp = await self.client.get(proxy_url, timeout=120.0)
                if resp.status_code == 200 and len(resp.text) > 10000:
                    return resp.text
                elif resp.status_code == 500:
                    wait = (2 ** attempt) * 5
                    await asyncio.sleep(wait)
                    continue
                elif resp.status_code == 429:
                    wait = (2 ** attempt) * 10
                    await asyncio.sleep(wait)
                    continue
            except Exception as e:
                await asyncio.sleep(2 ** attempt)
                continue
        return None

    def _extract_product_ids(self, html: str) -> list[str]:
        if not html or len(html) < 1000:
            return []
        patterns = [
            r'"productId":"(\d+)"',
            r'"itemId":"(\d+)"',
            r'/p/[^/]+/-/A-(\d+)',
            r'data-item-id="(\d+)"',
            r'"p13nProductId":"(\d+)"',
        ]
        all_ids = set()
        for pattern in patterns:
            matches = re.findall(pattern, html)
            all_ids.update(matches)
        return list(all_ids)

    def _extract_jsonld(self, html: str) -> list[dict[str, Any]]:
        products = []
        scripts = re.findall(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE
        )
        for s in scripts:
            try:
                data = json.loads(s.strip())
                if isinstance(data, dict):
                    if data.get("@type") == "Product":
                        products.append(data)
                    elif data.get("@type") == "ItemList":
                        for item in data.get("itemListElement", []):
                            if isinstance(item, dict) and item.get("@type") == "Product":
                                products.append(item)
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and item.get("@type") == "Product":
                            products.append(item)
            except Exception:
                continue
        return products

    def _extract_offers_from_jsonld(self, jsonld: dict) -> dict:
        offers = jsonld.get("offers", {})
        if isinstance(offers, list):
            offers = offers[0] if offers else {}
        return offers

    def _parse_price(self, value: str | float | None) -> float:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        cleaned = str(value).replace("$", "").replace(",", "").replace("USD", "").strip()
        match = re.search(r"[\d]+(?:\.\d+)?", cleaned)
        if not match:
            return 0.0
        try:
            return float(match.group(0))
        except ValueError:
            return 0.0

    def transform_product(self, data: dict[str, Any], category_name: str, category_sub: str) -> dict[str, Any] | None:
        try:
            jsonld = data.get("jsonld", {})
            product_url = data.get("url", "")
            product_id = data.get("product_id", "")

            name = jsonld.get("name", "").strip()
            if not name:
                return None

            sku = product_id or re.sub(r"[^a-zA-Z0-9]", "", name.lower())[:64]

            offers = self._extract_offers_from_jsonld(jsonld)
            price = self._parse_price(offers.get("price", 0))
            if price == 0:
                price = self._parse_price(jsonld.get("price", 0))

            currency = offers.get("priceCurrency", "USD")

            image_raw = jsonld.get("image", "")
            if isinstance(image_raw, list):
                image_url = image_raw[0] if image_raw else ""
            elif isinstance(image_raw, dict):
                image_url = image_raw.get("url", "") or image_raw.get("src", "")
            else:
                image_url = str(image_raw) if image_raw else ""

            availability_raw = offers.get("availability", "")
            is_active = "InStock" in str(availability_raw) or "InStock" in str(jsonld.get("availability", ""))

            brand = ""
            brand_raw = jsonld.get("brand", {})
            if isinstance(brand_raw, dict):
                brand = brand_raw.get("name", "")
            elif isinstance(brand_raw, str):
                brand = brand_raw

            description = jsonld.get("description", "")
            if isinstance(description, list):
                description = " ".join(str(d) for d in description)
            description = str(description)[:2000]

            upc = ""
            upc_match = re.search(r"\b\d{12}\b", str(jsonld))
            if upc_match:
                upc = upc_match.group()

            category_path = [category_name]
            if category_sub and category_sub.lower() != category_name.lower():
                category_path.append(category_sub)

            rating = 0.0
            rating_raw = jsonld.get("aggregateRating", {})
            if isinstance(rating_raw, dict):
                rating = self._parse_price(rating_raw.get("ratingValue", 0))

            review_count = 0
            review_raw = jsonld.get("aggregateRating", {})
            if isinstance(review_raw, dict):
                count_match = re.search(r"\d+", str(review_raw.get("reviewCount", 0)))
                if count_match:
                    review_count = int(count_match.group())

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": description,
                "price": price,
                "currency": currency,
                "url": product_url,
                "image_url": image_url,
                "category": category_name,
                "category_path": category_path,
                "brand": brand,
                "is_active": is_active,
                "in_stock": is_active,
                "metadata": {
                    "region": "us",
                    "country_code": "US",
                    "homedepot_product_id": product_id,
                    "upc": upc or None,
                    "rating": rating,
                    "review_count": review_count,
                    "availability": availability_raw,
                    "source_type": "jsonld",
                    "scraped_at": int(time.time()),
                },
            }
        except Exception as e:
            print(f"Transform error: {e}")
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            self._write_products_to_file(products)
            return len(products), 0, 0

        url = f"{self.api_base}/v1/ingest/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"source": SOURCE, "products": products}

        try:
            resp = await self.client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            result = resp.json()
            return (
                result.get("rows_inserted", 0),
                result.get("rows_updated", 0),
                result.get("rows_failed", 0),
            )
        except Exception as e:
            print(f"Ingestion error: {e}")
            return 0, 0, len(products)

    async def fetch_search_page(self, path: str, page: int = 1) -> list[str]:
        url = f"{BASE_URL}{path.format(page=page)}"
        async with self._semaphore:
            html = await self._fetch_with_scraperapi(url)
        if not html:
            return []
        return self._extract_product_ids(html)

    async def fetch_product_detail(self, product_id: str) -> dict[str, Any] | None:
        url = f"{BASE_URL}/p/-/{product_id}"
        async with self._semaphore:
            html = await self._fetch_with_scraperapi(url)
        if not html:
            return None

        jsonld_products = self._extract_jsonld(html)
        for jsonld in jsonld_products:
            if jsonld.get("@type") == "Product":
                return {"jsonld": jsonld, "url": url, "product_id": product_id}
        return None

    async def scrape_category(self, category: dict[str, Any]) -> dict[str, int]:
        cat_id = category["id"]
        cat_name = category["name"]
        cat_sub = category["sub"]
        path = category["path"]

        print(f"[{cat_name} / {cat_sub}] Starting...")
        counts: dict[str, int] = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}
        batch: list[dict[str, Any]] = []
        page = 1
        consecutive_empty = 0

        while page <= self.max_pages_per_category:
            if self.target > 0 and self.total_scraped >= self.target:
                print(f"Limit of {self.target} products reached")
                break

            print(f"[{cat_name}] Page {page}: fetching...")
            product_ids = await self.fetch_search_page(path, page)

            if not product_ids:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    print(f"[{cat_name}] No products for 3 consecutive pages, ending pagination")
                    break
                print(f"[{cat_name}] Page {page}: no product IDs found")
                await asyncio.sleep(self.delay)
                page += 1
                continue

            consecutive_empty = 0
            counts["pages"] += 1
            print(f"  Found {len(product_ids)} product IDs")

            for product_id in product_ids:
                if self.target > 0 and self.total_scraped >= self.target:
                    break

                if product_id in self._seen_ids:
                    continue
                self._seen_ids.add(product_id)

                detail = await self.fetch_product_detail(product_id)
                if not detail:
                    continue

                transformed = self.transform_product(detail, cat_name, cat_sub)
                if not transformed:
                    continue

                batch.append(transformed)
                counts["scraped"] += 1
                self.total_scraped += 1

                if len(batch) >= self.batch_size:
                    i, u, f = await self.ingest_batch(batch)
                    counts["ingested"] += i
                    counts["updated"] += u
                    counts["failed"] += f
                    self.total_ingested += i
                    self.total_updated += u
                    self.total_failed += f
                    batch = []
                    await asyncio.sleep(self.delay)

                await asyncio.sleep(0.5)

            await asyncio.sleep(self.delay)
            page += 1

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        self._category_stats[cat_id] = counts
        print(f"[{cat_name} / {cat_sub}] Done: {counts}")
        return counts

    async def run(self) -> dict[str, Any]:
        print("Home Depot US Ultra Scraper starting...")
        print(f"Mode: {'scrape only' if self.scrape_only else f'API: {self.api_base}'}")
        print(f"ScraperAPI: ultra_premium=true")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s, Concurrency: {self.concurrency}")
        print(f"Output file: {self._output_file}")
        print(f"Categories: {len(CATEGORIES)}")
        print(f"Target: {self.target} products")

        start = time.time()

        for category in CATEGORIES:
            if self.target > 0 and self.total_scraped >= self.target:
                break

            await self.scrape_category(category)
            await asyncio.sleep(2)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self._output_file,
            "category_stats": self._category_stats,
            "unique_skus": len(self._seen_ids),
        }
        print(f"Scraper complete: {summary}")
        return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Home Depot US product scraper (ultra_premium)")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between requests (seconds)")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere-api/data/homedepot_us")
    parser.add_argument("--target", type=int, default=200000, help="Target number of products to scrape")
    parser.add_argument("--concurrency", type=int, default=8, help="Concurrency level")
    parser.add_argument("--max-pages", type=int, default=100, help="Max pages per category")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--scraperapi-key", default=None, help="ScraperAPI key")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = HomeDepotUSUltraScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        data_dir=args.data_dir,
        target=args.target,
        scrape_only=args.scrape_only,
        scraperapi_key=args.scraperapi_key,
        concurrency=args.concurrency,
        max_pages_per_category=args.max_pages,
    )
    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
