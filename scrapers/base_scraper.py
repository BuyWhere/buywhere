"""Base scraper class and run_scraper helper for BuyWhere scrapers."""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Type

import httpx

from scrapers.scraper_logging import get_logger


class BaseScraper:
    """Base class for BuyWhere scrapers."""

    MERCHANT_ID: str = ""
    SOURCE: str = ""
    BASE_URL: str = ""
    DEFAULT_HEADERS: dict = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        data_dir: str | None = None,
        limit: int = 0,
        scrape_only: bool = False,
        max_retries: int = 3,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.limit = limit
        self.scrape_only = scrape_only
        self.max_retries = max_retries
        self.log = get_logger(self.SOURCE or self.MERCHANT_ID)
        self.client = httpx.AsyncClient(timeout=30.0, headers=self.DEFAULT_HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._outfile: str | None = None
        if data_dir:
            self._data_dir = Path(data_dir)
        else:
            self._data_dir = Path("/home/paperclip/buywhere-api/data") / self.SOURCE
        self._ensure_output_dir()

    def _ensure_output_dir(self) -> None:
        self._data_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self._outfile = str(self._data_dir / f"products_{ts}.ndjson")

    @property
    def products_outfile(self) -> str:
        if self._outfile is None:
            ts = time.strftime("%Y%m%d_%H%M%S")
            self._outfile = str(self._data_dir / f"products_{ts}.ndjson")
        return self._outfile

    async def close(self) -> None:
        await self.client.aclose()

    async def _get_with_retry(
        self, url: str, params: dict | None = None, retries: int | None = None
    ) -> httpx.Response | None:
        retries = retries if retries is not None else self.max_retries
        for attempt in range(retries):
            try:
                resp = await self.client.get(url, params=params)
                if resp.status_code == 200:
                    return resp
                elif resp.status_code in (429, 503):
                    wait = 2 ** attempt * 5
                    self.log.progress(f"Rate limited (HTTP {resp.status_code}), waiting {wait}s")
                    await asyncio.sleep(wait)
                else:
                    self.log.request_failed(url, attempt, f"HTTP {resp.status_code}")
                    if attempt < retries - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return None
            except Exception as e:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self.log.network_error(url, str(e))
                    return None
        return None

    async def ingest_batch(self, batch: list[dict]) -> tuple[int, int, int]:
        if self.scrape_only:
            return await self._save_batch(batch)
        return await self._ingest_batch_api(batch)

    async def _save_batch(self, batch: list[dict]) -> tuple[int, int, int]:
        ingested = 0
        failed = 0
        with open(self.products_outfile, "a", encoding="utf-8") as f:
            for item in batch:
                try:
                    f.write(json.dumps(item, ensure_ascii=False) + "\n")
                    ingested += 1
                except Exception:
                    failed += 1
        return ingested, 0, failed

    async def _ingest_batch_api(self, batch: list[dict]) -> tuple[int, int, int]:
        if not batch:
            return 0, 0, 0
        for attempt in range(self.max_retries):
            try:
                resp = await self.client.post(
                    f"{self.api_base}/v1/ingest/products",
                    json=batch,
                    headers={"X-API-Key": self.api_key, "Content-Type": "application/json"},
                    timeout=60.0,
                )
                if resp.status_code == 200:
                    result = resp.json()
                    return result.get("ingested", len(batch)), result.get("updated", 0), result.get("failed", 0)
                elif resp.status_code in (429, 503):
                    wait = 2 ** attempt * 5
                    self.log.progress(f"Ingestion rate limited (HTTP {resp.status_code}), waiting {wait}s")
                    await asyncio.sleep(wait)
                else:
                    self.log.ingestion_error(None, f"HTTP {resp.status_code}", attempt)
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return 0, 0, len(batch)
            except Exception as e:
                self.log.ingestion_error(None, str(e), attempt)
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return 0, 0, len(batch)
        return 0, 0, len(batch)

    def get_categories(self) -> list[dict]:
        raise NotImplementedError

    async def fetch_page(self, category: dict, page: int) -> list[dict]:
        raise NotImplementedError

    def transform(self, raw: dict, category: dict) -> dict[str, Any] | None:
        raise NotImplementedError

    async def scrape_category(self, category: dict) -> dict[str, int]:
        cat_id = category["id"]
        cat_name = category.get("name", "")
        sub_name = category.get("sub", "")

        self.log.progress(f"[{cat_name} / {sub_name}] Starting scrape...")
        counts: dict[str, int] = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}
        page = 1
        batch: list[dict] = []
        consecutive_empty = 0
        max_pages_per_category = 200

        while consecutive_empty < 5:
            if self.limit > 0 and self.total_scraped >= self.limit:
                break
            if self.total_scraped >= 50000 and "target_products" not in self.__dict__:
                pass
            if "target_products" in self.__dict__ and self.total_scraped >= self.target_products:
                break

            products_raw = await self.fetch_page(category, page)

            if not products_raw:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    self.log.progress(f"No products for 3 consecutive pages, ending pagination for {cat_id}")
                    break
                page += 1
                await asyncio.sleep(self.delay)
                continue

            consecutive_empty = 0
            counts["pages"] += 1

            for raw in products_raw:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    break
                try:
                    transformed = self.transform(raw, category)
                except Exception as e:
                    self.log.transform_error(None, f"{type(e).__name__}: {e}")
                    continue

                if transformed:
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

            self.log.progress(f"  page={page}, scraped={counts['scraped']}, total={self.total_scraped}")

            if len(products_raw) < 20:
                break

            if page >= max_pages_per_category:
                break

            page += 1

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        self.log.progress(f"[{cat_name} / {sub_name}] Done: {counts}")
        return counts

    async def run(self) -> dict[str, Any]:
        self.log.progress(f"{self.SOURCE or self.MERCHANT_ID} Scraper starting...")
        self.log.progress(f"Mode: {'scrape only' if self.scrape_only else f'API: {self.api_base}'}")
        self.log.progress(f"Output: {self.products_outfile}")

        start = time.time()
        categories = self.get_categories()
        self.log.progress(f"Categories: {len(categories)}")

        tasks = [self.scrape_category(cat) for cat in categories]
        await asyncio.gather(*tasks)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "categories_covered": len(categories),
        }

        self.log.progress(f"Scraper complete: {summary}")
        return summary

    @classmethod
    def add_cli_args(cls, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--api-key", required=True, help="BuyWhere API key")
        parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
        parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
        parser.add_argument("--delay", type=float, default=1.0, help="Delay between pages (seconds)")
        parser.add_argument("--data-dir", default=None, help="Directory to save scraped NDJSON data")
        parser.add_argument("--limit", type=int, default=0, help="Maximum number of products to scrape (0 = unlimited)")
        parser.add_argument("--scrape-only", action="store_true", help="Save to NDJSON without ingesting")
        parser.add_argument("--target", type=int, default=50000, help="Target number of products")

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "BaseScraper":
        return cls(
            api_key=args.api_key,
            api_base=args.api_base,
            batch_size=args.batch_size,
            delay=args.delay,
            data_dir=args.data_dir,
            limit=args.limit,
            scrape_only=args.scrape_only,
        )


async def run_scraper(scraper_cls: Type[BaseScraper]) -> None:
    """Helper to run a scraper from its class."""
    parser = argparse.ArgumentParser(description=scraper_cls.__name__)
    scraper_cls.add_cli_args(parser)
    args = parser.parse_args()
    scraper = scraper_cls.from_args(args)
    try:
        await scraper.run()
    finally:
        await scraper.close()
