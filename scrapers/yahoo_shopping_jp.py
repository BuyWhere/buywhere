"""
Yahoo Shopping Japan product scraper.

Scrapes product search results from Yahoo Japan Shopping (shopping.yahoo.co.jp) and outputs
structured JSON matching the BuyWhere catalog schema for ingestion via
POST /v1/ingest/products.

Usage:
    python -m scrapers.yahoo_shopping_jp --api-key <key> [--batch-size 100] [--delay 2.0]
    python -m scrapers.yahoo_shopping_jp --scrape-only

Categories covered: Electronics, Fashion, Home
Target: 80,000+ products with country_code=JP
"""

import argparse
import asyncio
import json
import os
import random
import re
import time
from typing import Any
from urllib.parse import urljoin, urlencode

import httpx
from bs4 import BeautifulSoup

MERCHANT_ID = "yahoo_jp"
SOURCE = "yahoo_jp"
BASE_URL = "https://shopping.yahoo.co.jp"
SEARCH_URL = "https://search.shopping.yahoo.co.jp/search"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/yahoo_jp"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9",
    "Referer": "https://shopping.yahoo.co.jp/",
}

RATE_LIMIT_WAIT = 30
MAX_RETRIES = 5

CATEGORIES = [
    {
        "id": "electronics",
        "name": "Electronics",
        "keywords": [
            "ノートパソコン",
            "デスクトップパソコン",
            "ゲームパソコン",
            "Chromebook",
            "MacBook",
            "Ultrabook",
            "スマートフォン",
            "iPhone",
            "Android",
            "洗濯機",
            "冷蔵庫",
            "掃除機",
            "ヘッドフォン",
            "ワイヤレスイヤホン",
            "Bluetoothスピーカー",
            "スマートウォッチ",
            "アクティビティトラッカー",
            "モニター",
            "外付けモニター",
            "キーボード",
            "マウス",
            "ウェブカメラ",
            "USBハブ",
            "メモリカード",
            "SSD",
            "HDD",
            "メモリ",
            "グラフィックボード",
            "WiFi-router",
            "モバイルバッテリー",
            "ケーブル",
            "アダプタ",
            "電源タップ",
            "プロジェクター",
            "テレビ",
            "Fire TV Stick",
            "Chromecast",
            "ブルーレイ",
            "DVDプレーヤー",
            "ホーム CINEMA",
            "サウンドバー",
            "DAC",
            "デジタルカメラ",
            "一眼レフカメラ",
            "ミラーレスカメラ",
            "コンパクトカメラ",
            "GoPro",
            "アクションカメラ",
            "Nintendo Switch",
            "PS5",
            "PlayStation 5",
            "Xbox Series X",
            "ゲームソフト",
            "VR headset",
            "スマートホーム",
            "ネットワークカメラ",
            "カメラ",
            "ゲーム機",
            "ゲーム控制器",
        ],
    },
    {
        "id": "fashion",
        "name": "Fashion",
        "keywords": [
            "ワンピース",
            "ブラウス",
            "スカート",
            "パンツ",
            "ジャケット",
            "コート",
            "靴",
            "スニーカー",
            "ブーツ",
            "アクセサリー",
            "バッグ",
            "钱包",
            "ベルト",
            "帽子",
            "围巾",
            "手套",
            "時計",
            "ネックレス",
            "イヤリング",
            "ブレスレット",
            "リング",
            "化妆品",
            "护肤品",
            "メイクアップ",
            "香水",
            "洗发水",
            "护发素",
            "バス用品",
            "タオル",
            "石けん",
            "スーツ",
            "ドレスシャツ",
            "ネクタイ",
            "革靴",
            "パンプス",
            " flat鞋",
            "運動靴",
            "サングラス",
            "眼鏡",
            " Frame",
            "指輪",
            "珍珠",
            " diamond",
            " gold",
            "銀",
            "レザー",
            "バッグ",
            " Clutch",
            " Backpack",
            "Wallet",
            "Card case",
            "母子手册",
            "マタニティ",
            "ベビーカー",
            "チャイルドシート",
            "ベッド",
            "布団",
            "食器",
            "おむつ",
        ],
    },
    {
        "id": "home",
        "name": "Home",
        "keywords": [
            "エア fryer",
            "布団",
            "収納",
            "デスクライト",
            "調理器具",
            "オフィスチェア",
            "如水筒",
            "Coffee maker",
            "空気清浄機",
            "加湿器",
            "圧力鍋",
            "トースター",
            "電気ケトル",
            "扇風機",
            "暖房器具",
            "食器乾燥機",
            "洗濯乾燥機",
            "アイロン",
            "ミシン",
            "家具",
            "ソファ",
            "テーブル",
            "椅子",
            "ベッド",
            "マットレス",
            "枕",
            "シーツ",
            "カバー",
            "タオル",
            "バスタオル",
            "洗面所",
            "バス用品",
            "キッチン用品",
            "保存容器",
            "フライパン",
            "鍋",
            "包丁",
            "砧板",
            "食器",
            "グラタン",
            "タッパー",
            "水筒",
            "保温バッグ",
            "ホームセキュリティ",
            "スマートロック",
            "温湿度計",
            "照明",
            "LED電球",
            "シーリングライト",
            "スタンドライト",
            "デスクライト",
            "庭園",
            "エクステリア",
            "テーブルタップ",
            "延長コード",
            "UPS",
            "电池",
            "灯泡",
            "殺虫剤",
            "、防虫",
            "、除湿",
            "乾燥",
            "、引越",
            "、整理",
            "、収納",
        ],
    },
]


class YahooShoppingJPScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 2.0,
        scrape_only: bool = False,
        output_dir: str | None = None,
        max_pages_per_keyword: int = 50,
        session_file: str | None = None,
        max_keywords: int | None = None,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.output_dir = output_dir or OUTPUT_DIR
        self.max_pages_per_keyword = max_pages_per_keyword
        self.session_file = session_file
        self.max_keywords = max_keywords
        self.client = httpx.AsyncClient(timeout=60.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_product_ids: set[str] = set()
        self._load_session()
        self._ensure_output_dir()

    def _load_session(self) -> None:
        if self.session_file and os.path.exists(self.session_file):
            try:
                with open(self.session_file, "r") as f:
                    data = json.load(f)
                    self.seen_product_ids = set(data.get("seen_product_ids", []))
                    print(f"Loaded session with {len(self.seen_product_ids)} previously scraped product IDs")
            except Exception:
                pass

    def _save_session(self) -> None:
        if self.session_file:
            try:
                with open(self.session_file, "w") as f:
                    json.dump({"seen_product_ids": list(self.seen_product_ids)}, f)
            except Exception:
                pass

    def _ensure_output_dir(self) -> None:
        os.makedirs(self.output_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(self.output_dir, f"products_{ts}.jsonl")

    async def close(self) -> None:
        await self.client.aclose()

    async def _get_with_retry(self, url: str, retries: int = MAX_RETRIES) -> str | None:
        scraperapi_key = os.environ.get("SCRAPERAPI_KEY")
        for attempt in range(retries):
            try:
                if scraperapi_key:
                    request_url = "http://api.scraperapi.com"
                    request_params = {
                        "api_key": scraperapi_key,
                        "url": url,
                    }
                else:
                    request_url = url
                    request_params = None

                resp = await self.client.get(request_url, params=request_params)

                if resp.status_code == 429:
                    wait = RATE_LIMIT_WAIT * (attempt + 1)
                    print(f"  Rate limited (429), waiting {wait}s before retry {attempt + 1}/{retries}")
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                return resp.text
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    wait = RATE_LIMIT_WAIT * (attempt + 1)
                    print(f"  Rate limited (HTTP {e.response.status_code}), waiting {wait}s")
                    await asyncio.sleep(wait)
                    continue
                if attempt < retries - 1:
                    wait = (2 ** attempt) * self.delay
                    await asyncio.sleep(wait)
                else:
                    return None
            except Exception:
                if attempt < retries - 1:
                    wait = (2 ** attempt) * self.delay
                    await asyncio.sleep(wait)
                else:
                    return None
        return None

    def _write_products_to_file(self, products: list[dict[str, Any]]) -> None:
        if not products:
            return
        with open(self.products_outfile, "a", encoding="utf-8") as f:
            for product in products:
                f.write(json.dumps(product, ensure_ascii=False) + "\n")

    def _parse_price(self, value: str | None) -> float:
        if not value:
            return 0.0
        cleaned = (
            value.replace("¥", "")
            .replace("\\", "")
            .replace(",", "")
            .replace("円", "")
            .strip()
        )
        match = re.search(r"[\d]+(?:\.\d+)?", cleaned)
        if not match:
            return 0.0
        try:
            return float(match.group(0))
        except ValueError:
            return 0.0

    def _parse_int(self, value: str | None) -> int:
        if not value:
            return 0
        digits = re.sub(r"[^\d]", "", value)
        return int(digits) if digits else 0

    def _extract_brand(self, title: str) -> str:
        if not title:
            return ""
        first_token = title.split()[0].strip("()[],:,-")
        if not first_token:
            return ""
        if any(char.isdigit() for char in first_token):
            return ""
        return first_token[:80]

    def _extract_rating(self, rating_text: str | None) -> float:
        if not rating_text:
            return 0.0
        match = re.search(r"(\d+(?:\.\d+)?)", rating_text)
        if match:
            try:
                rating = float(match.group(1))
                if rating <= 5.0:
                    return rating
            except ValueError:
                pass
        return 0.0

    def transform_product(
        self, raw: dict[str, Any], category_name: str, keyword: str
    ) -> dict[str, Any] | None:
        try:
            product_id = str(raw.get("product_id", "") or raw.get("url", "")).strip()
            if not product_id:
                return None

            title = (raw.get("title") or "").strip()
            if not title:
                return None

            url = raw.get("url") or ""
            if url and not url.startswith("http"):
                url = urljoin(BASE_URL, url)

            price = self._parse_price(raw.get("price"))
            original_price_str = raw.get("original_price")
            original_price = self._parse_price(original_price_str) if original_price_str else price
            if original_price == 0:
                original_price = price

            review_count = self._parse_int(raw.get("review_count"))
            rating = self._extract_rating(raw.get("rating"))

            image_url = raw.get("image_url") or ""

            category_path = [category_name]
            if keyword and keyword.lower() != category_name.lower():
                category_path.append(keyword)

            brand = raw.get("brand") or self._extract_brand(title)

            merchant_rating = raw.get("merchant_rating")
            if merchant_rating:
                try:
                    merchant_rating = float(merchant_rating)
                except (ValueError, TypeError):
                    merchant_rating = None

            product = {
                "merchant_id": MERCHANT_ID,
                "source": SOURCE,
                "source_product_id": product_id,
                "title": title[:500] if title else None,
                "url": url,
                "image_url": image_url,
                "price": price,
                "original_price": original_price,
                "currency": "JPY",
                "rating": rating,
                "review_count": review_count,
                "category": category_path,
                "brand": brand,
                "tags": [],
                "country_code": "JP",
                "region": "jp",
                "in_stock": raw.get("in_stock", True),
                "merchant_name": raw.get("merchant_name") or "Yahoo Shopping",
                "merchant_rating": merchant_rating,
            }

            return product
        except Exception:
            return None

    def _parse_beacon(self, beacon_str: str) -> dict[str, str]:
        result = {}
        for part in beacon_str.split(";"):
            if ":" in part:
                key, value = part.split(":", 1)
                result[key.strip()] = value.strip()
        return result

    def _parse_search_page(self, html: str, category_name: str, keyword: str) -> tuple[list[dict[str, Any]], bool]:
        products = []
        soup = BeautifulSoup(html, "html.parser")

        items = soup.select("[data-beacon]")
        
        has_next_page = len(items) > 0

        for item in items:
            try:
                beacon_str = item.get("data-beacon", "")
                beacon = self._parse_beacon(beacon_str)

                product_url = beacon.get("targurl", "")
                if not product_url:
                    img_link = item.select_one("a[href]")
                    if img_link:
                        product_url = img_link.get("href", "")

                itemcode = beacon.get("itemcode", "")
                jan = beacon.get("jan", "")
                product_id = itemcode or jan

                if not product_id:
                    continue

                img_elem = item.select_one("img")
                title = ""
                image_url = ""
                if img_elem:
                    title = img_elem.get("alt", "")
                    image_url = img_elem.get("src", "") or img_elem.get("data-src", "")

                price_text = beacon.get("prc", "") or beacon.get("o_prc", "")
                original_price_text = beacon.get("o_prc", "") or price_text

                rating_text = beacon.get("rvw_rate", "")
                review_count_text = beacon.get("rvw_cnt", "")

                merchant_id = beacon.get("cid", "")
                merchant_name = beacon.get("storeid", "") or "Yahoo Shopping"
                merchant_rating_text = beacon.get("str_rate", "")

                raw = {
                    "product_id": product_id,
                    "title": title,
                    "price": price_text,
                    "original_price": original_price_text,
                    "rating": rating_text,
                    "review_count": review_count_text,
                    "image_url": image_url,
                    "url": product_url,
                    "merchant_name": merchant_name,
                    "merchant_rating": merchant_rating_text,
                    "in_stock": True,
                }

                product = self.transform_product(raw, category_name, keyword)
                if product:
                    products.append(product)

            except Exception:
                continue

        return products, has_next_page

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.api_base}/v1/ingest/products",
                    json=products,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("inserted", 0), data.get("updated", 0), data.get("failed", 0)
                else:
                    print(f"  Ingest failed: {resp.status_code} {resp.text[:200]}")
                    return 0, 0, len(products)
        except Exception as e:
            print(f"  Ingest error: {e}")
            return 0, 0, len(products)

    async def scrape_keyword(self, category: dict[str, Any], keyword: str) -> dict[str, int]:
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "has_next": False}
        batch = []
        batch_ids = []
        page = 1
        has_next_page = True

        while page <= self.max_pages_per_keyword and has_next_page:
            params = {"p": keyword}
            if page > 1:
                params["page"] = page

            search_url = f"{SEARCH_URL}?{urlencode(params)}"

            html = await self._get_with_retry(search_url)
            if not html:
                print(f"  Page {page}: failed to fetch")
                break

            parsed_products, has_next_page = self._parse_search_page(html, category["name"], keyword)
            counts["has_next"] = has_next_page

            fresh_products = [p for p in parsed_products if p["source_product_id"] not in self.seen_product_ids]
            counts["scraped"] += len(parsed_products)
            self.total_scraped += len(parsed_products)

            for product in fresh_products:
                batch.append(product)
                batch_ids.append(product["source_product_id"])
                if len(batch) >= self.batch_size:
                    if self.scrape_only:
                        self._write_products_to_file(batch)
                        i, u, f = len(batch), 0, 0
                    else:
                        i, u, f = await self.ingest_batch(batch)
                    for pid in batch_ids:
                        self.seen_product_ids.add(pid)
                    counts["ingested"] += i
                    counts["updated"] += u
                    counts["failed"] += f
                    self.total_ingested += i
                    self.total_updated += u
                    self.total_failed += f
                    batch = []
                    batch_ids = []
                    await asyncio.sleep(self.delay)

            print(f"  Page {page}: parsed={len(parsed_products)} new={len(fresh_products)} total={counts['scraped']}")

            if page % 5 == 0:
                self._save_session()

            if not has_next_page:
                break

            await asyncio.sleep(self.delay + random.uniform(0.5, 1.5))
            page += 1

        if batch:
            if self.scrape_only:
                self._write_products_to_file(batch)
                i, u, f = len(batch), 0, 0
            else:
                i, u, f = await self.ingest_batch(batch)
            for pid in batch_ids:
                self.seen_product_ids.add(pid)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        self.total_scraped += counts["scraped"]
        self._save_session()
        return counts

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print("Yahoo Shopping Japan Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Max pages per keyword: {self.max_pages_per_keyword}")
        print(f"Output: {self.products_outfile}")

        total_keywords = sum(len(c["keywords"]) for c in CATEGORIES)
        effective_target = self.max_keywords if self.max_keywords else total_keywords
        print(f"Categories: {len(CATEGORIES)}, Keywords: {total_keywords} (running {effective_target})")
        print(f"Target: 80,000+ products")

        start = time.time()
        keyword_count = 0

        for category in CATEGORIES:
            for keyword in category["keywords"]:
                if self.max_keywords is not None and keyword_count >= self.max_keywords:
                    print(f"Max keywords ({self.max_keywords}) reached, stopping")
                    break
                counts = await self.scrape_keyword(category, keyword)
                print(f"  [{category['name']} / {keyword}] Done: {counts}")
                keyword_count += 1
                await asyncio.sleep(self.delay + random.uniform(0.5, 1.5))
            else:
                continue
            break

        elapsed = time.time() - start
        self._save_session()
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "unique_product_ids": len(self.seen_product_ids),
        }
        print(f"\nScraper complete: {summary}")
        return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Yahoo Shopping Japan Scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument(
        "--delay", type=float, default=2.0, help="Delay between requests/batches (seconds)"
    )
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--max-pages-per-keyword", type=int, default=50)
    parser.add_argument("--max-keywords", type=int, default=None, help="Limit number of keywords to scrape (default: all)")
    parser.add_argument("--session-file", help="Path to session file for resume support")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = YahooShoppingJPScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        output_dir=args.output_dir,
        max_pages_per_keyword=args.max_pages_per_keyword,
        session_file=args.session_file,
        max_keywords=args.max_keywords,
    )

    try:
        summary = await scraper.run()
        print(f"\nFinal summary: {json.dumps(summary, indent=2)}")
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())