"""
Amazon Japan product scraper.

Usage:
    python -m scrapers.amazon_jp --scrape-only [--session-file session.json]
"""

import argparse
import asyncio
import json
import os
import re
import time
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

MERCHANT_ID = "amazon_jp"
SOURCE = "amazon_jp"
BASE_URL = "https://www.amazon.co.jp"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/amazon_jp"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9",
    "Referer": "https://www.amazon.co.jp/",
}

RATE_LIMIT_WAIT = 30
MAX_RETRIES = 5

CATEGORIES = [
    {"id": "electronics", "name": "Electronics", "keywords": [
        "ノートパソコン", "デスクトップパソコン", "ゲームパソコン", "Chromebook", "MacBook", "Ultrabook",
        "スマートフォン", "Android", "iPhone", "洗濯機", "冷蔵庫", "掃除機", "ヘッドフォン",
        "ワイヤレスイヤホン", "Bluetoothスピーカー", "スマートウォッチ", "アクティビティトラッカー",
        "モニター", "外付けモニター", "キーボード", "マウス", "ウェブカメラ", "USBハブ",
        "メモリカード", "SSD", "HDD", "メモリ", "グラフィックボード", "ネットワーク機器",
        "WiFi-router", "モバイルバッテリー", "充電器", "ケーブル", "アダプタ", "電源タップ",
        "UPS", "プロジェクター", "スクリーン", "テレビ", "Fire TV Stick", "Chromecast",
        "ブルーレイ", "DVDプレーヤー", "ホーム CINEMA", "サウンドバー", "ポタアン", "DAC",
        "デジタルカメラ", "一眼レフカメラ", "ミラーレスカメラ", "コンパクトカメラ", "GoPro",
        "アクションカメラ", "ビデオカメラ", "カメラケース", "レンズ", "フィルター", "ドローン",
        "ゲーム機", "Nintendo Switch", "Switch", "PS5", "PlayStation 5", "Xbox Series X",
        "Xbox", "ゲームソフト", "ゲーム控制器", "VR headset", "VR", "ヘッドセット",
        "スマートホーム", "スマートロック", "ネットワークカメラ",
    ]},
    {"id": "computers", "name": "Computers", "keywords": [
        "パソコン", "PC", "デスクトップ", "タワー", "一体型PC", "ミニPC", "Stick PC",
        "Computing", "ノートPC", "Ultrabook", "ビジネスノート", "Chromebook", "MacBook Air",
        "MacBook Pro", "iPad", "Surface", "Androidタブレット", "Fire HD", "Lenovo Tab",
        "Samsung Tab", "huawei matepad", "キーボード", "マウス", "トラックボール", "トラックパッド",
        "drawing tablet", "ペンタブレット", "webcam", "document camera", "モニター", "曲面モニター",
        "4Kモニター", "モニターアーム", "モニター支架", "HDMI cable", "DisplayPort", "USB-C",
        "アダプタ", "ドッキングステーション", "ポート拡張", "外付けGPU", "eGPU", "グラボ",
        "Graphics card", "GPU", "RTX", "Radeon", "メモリ", "RAM", "DDR4", "DDR5",
        "SSD", "M.2 SSD", "SATA SSD", "外付けSSD", "HDD", "外付けHDD", "NAS", "ネットワークHDD",
        "スイッチ", "Router", "WiFi", "モデム", "LANカード", "Bluetooth adapter", "UPS", "APC",
        " Printer", "インクjet", "Laser", "トナー", "スキャナ", "プロジェクタ", "計算機", "電卓",
    ]},
    {"id": "cameras", "name": "Cameras & Photography", "keywords": [
        "カメラ", "デジタルカメラ", "一眼レフ", "一眼", "ミラーレス", "Canon", "Nikon", "Sony",
        "Fujifilm", "Olympus", "Panasonic", "Pentax", "RICOH", "Leica", "中判", "Medium format",
        "コンパクト", "高級コンパクト", "フィルムカメラ", "ポラロイド", "instax", "GoPro",
        "アクションカメラ", "360カメラ", "全天球", "Insta360", "RICOH THETA", "ドローン",
        "DJI", "Mavic", "Phantom", "Spark", "Mini", "Autel", "Holy Stone", "ジンバル",
        "一脚", "三脚", "一脚", "LED light", "照明", "リングライト", "フラッシュ",
        "レリーズ", "タイマー", " Remote", "フィルター", "PLフィルター", "NDフィルター",
        "UVフィルター", "保護フィルター", "レンズ", "単焦点", "標準ズーム", "広角ズーム", "望遠ズーム",
        " マクロ", " 接写", " 魚眼", " Lens", "Tamron", "Sigma", "Tokina", "Zeiss",
        "B+W", "Hoya", "Kenko", "レンズフィルター", "レンズキャップ", " 防湿庫", "カメラケース",
        "Shoulder bag", "リュック", "Top load", "Sling bag", "Pouch", "Hard case", "Soft case",
        "Strap", "カメラストラップ", "自拍杆", "セルカ棒",
    ]},
    {"id": "gaming", "name": "Gaming & Entertainment", "keywords": [
        "ゲーム機", "ゲームコンソール", "Nintendo Switch", "Switch", "Switch有機EL", "Switchlite",
        "Joy-Con", "プロコン", "PS5", "PlayStation 5", "PS5 Disc", "PS5 Digital", "DualSense",
        "PS5-controllers", "Xbox Series X", "Xbox Series S", "Xbox", "Xbox Controller",
        "Steam Deck", "Handheld", "Retroid", "Anbernic", "ゲームソフト", "ゲーム光盘",
        "ゲームDL", "Nintendo Switch Game", "PS5 Game", "Xbox Game", "Steam Game", "PC Game",
        "ゲーム予約", "VR", "VR headset", "Oculus", "Meta Quest", "Quest 2", "Quest 3",
        "HTC Vive", "Valve Index", "PSVR", "VRゲーム", "VRアクセサリー", "アーケード",
        "レトロコンソール", "ファミコン", "スーファミ", "N64", "ゲームボーイ",
        "ゲーム取り", "キャプチャーカード", "録画", "RPG", "ACT", "SLG", "シミュレーション",
        " Ring Fit", "Just Dance", "Nintendo Ring", "Amiibo", "NFC", "Board game",
        "テーブルゲーム", "カードゲーム", "ジグソーパズル", "パズル", "Construct", "DIY",
        "レゴ", " LEGO", "Megablocks", "Barbie", "人形", "Figure", " Funko Pop",
        "プラモデル", "Gunpla", "スケールモデル", "ダーツ", "卓球", "Pinball",
        "Chess", "Chess set", " 将棋", "Shogi", "囲碁", "Card", "TCG", "Card game",
        "Trading card", "Pokemon", "Magic", "Fighting", "eSports", " Twitch",
        " stream", "ゲーム配信", "Webcam", "Mic", "ゲームヘッドセット", "Monitor",
        "144Hz", "240Hz", "1ms", "G-Sync", "FreeSync", "曲面", "49インチ", "34インチ",
        "27インチ", "32インチ", " Gaming monitor", "Desk", "ゲームチェア",
    ]},
    {"id": "home", "name": "Home", "keywords": [
        "エア fryer", "掃除機", "布団", "収納", "デスクライト", "調理器具", "オフィスチェア",
        "如水筒", "Coffee maker", "空気清浄機", "加湿器", "圧力鍋", "トースター",
        "電気ケトル", "扇風機", "暖房器具", "食器乾燥機", "洗濯乾燥機", "アイロン", "ミシン",
    ]},
    {"id": "fashion", "name": "Fashion", "keywords": [
        "ワンピース", "ブラウス", "スカート", "パンツ", "ジャケット", "コート", "靴",
        "スニーカー", "ブーツ", "アクセサリー", "バッグ", "時計", "ジュエリー", "sunglasses",
        "帽子", "スカーフ", "ベルト", "マフラー",
    ]},
    {"id": "beauty", "name": "Beauty", "keywords": [
        "护肤品", "化妆品", "香水", "洗发水", "护发素", "面膜", "防晒霜", "口红", "粉底",
        "眉笔", "指甲油", "睫毛膏", "乳液", "精华液", "洁面乳", "剃须刀", "身体乳", "洗手液",
    ]},
    {"id": "sports", "name": "Sports & Outdoors", "keywords": [
        "ヨガマット", "ダンベル", "自転車", " Camping", "登山用品", "水泳ゴーグル",
        "健身器材", "网球拍", "足球", "篮球", "羽毛球拍", "钓鱼竿", "跑步鞋", "运动袜",
        "蛋白粉", "营养补剂", "健身服", "登山靴",
    ]},
    {"id": "toys", "name": "Toys & Games", "keywords": [
        "lego", "人形", " board game", "パズル", "ラジコン", "知育玩具", "屋外玩具",
        "绘画用品", "键盘玩具", "积木", "扑克牌", "电子游戏", "毛绒玩具", "轨道火车", "科学キット",
    ]},
    {"id": "books", "name": "Books", "keywords": [
        "小説", "ビジネス書", "自己启发", "漫画", "雑誌", "絵本", "料理本", "旅行案内",
        "技術書", "歴史書", "科学", "ミステリー", "SF", "ファンタジー", "ロマンス", "実用書",
    ]},
    {"id": "food", "name": "Food & Grocery", "keywords": [
        "お菓子", "巧克力", "饼干", "カップ麺", "レトルト", "大米", "面粉", "調味料",
        " Coffee豆", "紅茶", "緑茶", "饮料", " 健康食品", "納豆", "味噌", "酱油", "油脂", "乾物",
    ]},
    {"id": "electronics_fresh", "name": "Electronics Fresh", "keywords": [
        "fire TV", "fire TV stick 4K", "fire TV stick max", "Apple TV 4K", "Apple TV HD",
        "Chromecast with Google TV", "Roku", "Roku Express", "Roku Streaming Stick",
        "TV box", "Android TV box", "ミニコンポ", "JBL", "Bose", "Sonos", "Sony speaker",
        "Panasonic speaker", "Sharp speaker", "Toshiba speaker", "audio technica", "Shure",
        "Sennheiser", "beyerdynamic", "audio interface", "mixer", "真空管 AMP",
        "サブwoofer", "ブックシェルフスピーカー", "フロア型スピーカー", "外付けHDD 4TB",
        "外付けHDD 8TB", "NAS 2Bay", "NAS 4Bay", "DDR5 RAM", "DDR5 32GB", "DDR5 64GB",
        "RTX 4090", "RTX 4080", "RTX 4070", "RX 7900", "intel CPU", "AMD CPU", "Ryzen 9",
        "Ryzen 7", "Ryzen 5", "Core i9", "Core i7", "Core i5", "Mini-ITXケース", "ATXケース",
        "Micro-ATXケース", "80 PLUS Gold", "水冷クーラー", "空冷クーラー", " SSD 2TB", " SSD 4TB",
    ]},
    {"id": "gaming_fresh", "name": "Gaming Fresh", "keywords": [
        "Fortnite", "Minecraft", "Apex Legends", "Call of Duty", "Overwatch 2",
        "League of Legends", "Valorant", "Genshin Impact", "原神", "Pokemon Scarlet",
        "Pokemon Violet", "Pokemon Legends", "Mario Kart 8", "Super Smash Bros", "Zelda",
        "Splatoon 3", "Metroid Prime", "Bayonetta 3", "Kirby", "星のカービィ",
        "どうぶつの森", "Animal Crossing", "大乱闘スマッシュ", "Street Fighter 6",
        "KOF", "Tekken 8", "Guilty Gear Strive", "Dragon Quest", "Xenoblade",
        "Fire Emblem Engage", "MARIO Party", "MARIO Tennis", "MARIO Golf",
        "Ring Fit Adventure", "Nintendo Switch Sports", "Fit Boxing", "Nintendo Switch Online",
        "PS Plus", "Xbox Game Pass", "Game Pass Ultimate",
    ]},
    {"id": "camera_fresh", "name": "Camera Fresh", "keywords": [
        "Canon EOS R", "Canon EOS R5", "Canon EOS R6", "Canon EOS R7", "Canon EOS R8",
        "Canon EOS R10", "Canon EOS R50", "Canon RF 15-35", "Canon RF 24-70", "Canon RF 70-200",
        "Canon RF 85", "Canon RF 50", "Nikon Z", "Nikon Z6", "Nikon Z6 III", "Nikon Z7",
        "Nikon Z8", "Nikon Z9", "Nikon Z50", "Nikon Zfc", "Sony A7", "Sony A7 IV",
        "Sony A7 V", "Sony A7R V", "Sony A7C", "Sony A6700", "Sony A6400", "Sony ZV",
        "Sony FX3", "Sony FE 16-35", "Sony FE 24-70", "Sony FE 70-200", "Sony FE 85", "Sony FE 50",
        "Fujifilm X", "Fujifilm X-T5", "Fujifilm X-H2", "Fujifilm X-H2S", "Fujifilm X-S20",
        "Fujifilm XF 16-55", "Fujifilm XF 18-55", "Fujifilm XF 23", "Fujifilm XF 35",
        "Fujifilm XF 56", "OM System OM-1", "Panasonic S5", "Panasonic S5 II", "Panasonic GH6",
        "Leica Q", "Leica M", "Leica SL", "Hasselblad X", "Sigma fp", "Sigma fp L",
        "Sigma 24-70", "Sigma 35", "Sigma 50", "Sigma 85", "Tamron 28-75", "Tamron 70-180",
    ]},
]


class AmazonJPScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 2.0,
        scrape_only: bool = False,
        output_dir: str | None = None,
        max_pages_per_keyword: int = 25,
        proxies: list[str] | None = None,
        session_file: str | None = None,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.output_dir = output_dir or OUTPUT_DIR
        self.max_pages_per_keyword = max_pages_per_keyword
        self.proxies = proxies or []
        self._proxy_index = 0
        self.session_file = session_file
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_asins: set[str] = set()
        self._load_session()
        self._ensure_output_dir()
    
    def _load_session(self) -> None:
        if self.session_file and os.path.exists(self.session_file):
            try:
                with open(self.session_file, "r") as f:
                    data = json.load(f)
                    self.seen_asins = set(data.get("seen_asins", []))
                    print(f"Loaded session with {len(self.seen_asins)} previously scraped ASINs")
            except Exception:
                pass
    
    def _save_session(self) -> None:
        if self.session_file:
            try:
                with open(self.session_file, "w") as f:
                    json.dump({"seen_asins": list(self.seen_asins)}, f)
            except Exception:
                pass
    
    def _get_proxy(self) -> str | None:
        all_proxies = self.proxies.copy()
        scraperapi_key = os.environ.get("SCRAPERAPI_KEY")
        if scraperapi_key:
            all_proxies.append(f"http://scraperapi:{scraperapi_key}@proxy-server.scraperapi.com:8001")
        if not all_proxies:
            return None
        proxy = all_proxies[self._proxy_index % len(all_proxies)]
        self._proxy_index += 1
        return proxy

    def _ensure_output_dir(self) -> None:
        os.makedirs(self.output_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(self.output_dir, f"products_{ts}.jsonl")

    async def close(self) -> None:
        await self.client.aclose()

    async def _get_with_retry(
        self, url: str, params: dict[str, Any] | None = None, retries: int = MAX_RETRIES
    ) -> str | None:
        scraperapi_key = os.environ.get("SCRAPERAPI_KEY")
        for attempt in range(retries):
            try:
                request_url = url
                request_params = params
                if scraperapi_key:
                    request_url = "http://api.scraperapi.com"
                    full_url = url
                    if params:
                        import urllib.parse
                        query = urllib.parse.urlencode(params)
                        full_url = f"{url}?{query}"
                    request_params = {
                        "api_key": scraperapi_key,
                        "url": full_url,
                        "render": "true",
                    }
                
                resp = await self.client.get(request_url, params=request_params)
                
                if resp.status_code == 429:
                    wait = RATE_LIMIT_WAIT * (attempt + 1)
                    print(f"  Rate limited (429), waiting {wait}s")
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
        cleaned = value.replace("¥", "").replace("\\", "").replace(",", "").strip()
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
        first_token = title.split()[0].strip("()[],:")
        if not first_token:
            return ""
        if any(char.isdigit() for char in first_token):
            return ""
        return first_token[:80]

    def transform_product(
        self, raw: dict[str, Any], category_name: str, keyword: str
    ) -> dict[str, Any] | None:
        try:
            asin = str(raw.get("asin", "") or raw.get("sku", "")).strip()
            if not asin:
                return None

            title = (raw.get("title") or "").strip()
            if not title:
                return None

            url = raw.get("url") or f"{BASE_URL}/dp/{asin}"
            if not url.startswith("http"):
                url = urljoin(BASE_URL, url)

            price = self._parse_price(raw.get("price"))
            original_price = self._parse_price(raw.get("original_price")) or price
            review_count = self._parse_int(raw.get("review_count"))

            rating = 0.0
            rating_text = raw.get("rating") or ""
            rating_match = re.search(r"(\d+(?:\.\d+)?)", rating_text)
            if rating_match:
                rating = float(rating_match.group(1))

            category_path = [category_name]
            if keyword and keyword.lower() != category_name.lower():
                category_path.append(keyword)

            is_prime = bool(raw.get("is_prime", False))
            
            return {
                "sku": asin,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("description") or "",
                "price": price,
                "currency": "JPY",
                "url": url,
                "image_url": raw.get("image_url") or "",
                "category": category_name,
                "category_path": category_path,
                "brand": raw.get("brand") or self._extract_brand(title),
                "is_active": True,
                "metadata": {
                    "keyword": keyword,
                    "original_price": original_price,
                    "rating": rating,
                    "review_count": review_count,
                    "is_sponsored": bool(raw.get("is_sponsored", False)),
                    "is_prime": is_prime,
                    "country_code": "JP",
                },
            }
        except Exception:
            return None

    def parse_search_results(
        self, html: str, category_name: str, keyword: str
    ) -> tuple[list[dict[str, Any]], bool]:
        soup = BeautifulSoup(html, "html.parser")
        products: list[dict[str, Any]] = []

        for card in soup.select('[data-component-type="s-search-result"][data-asin]'):
            asin = (card.get("data-asin") or "").strip()
            if not asin:
                continue

            title_el = card.select_one("h2 span")
            if not title_el:
                continue

            link_el = card.select_one("h2 a")
            price_el = card.select_one(".a-price .a-offscreen")
            original_price_el = card.select_one(".a-text-price .a-offscreen")
            image_el = card.select_one("img.s-image")
            rating_el = card.select_one(".a-icon-alt")
            review_el = card.select_one('a[href*="#customerReviews"] span')
            sponsored_el = card.select_one('[aria-label="Sponsored"], .puis-sponsored-label-text')
            prime_el = card.select_one('.a-icon-prime, [aria-label*="Prime"], .prime-badge')

            raw_product = {
                "asin": asin,
                "title": title_el.get_text(" ", strip=True),
                "url": link_el.get("href", "") if link_el else "",
                "price": price_el.get_text(strip=True) if price_el else "",
                "original_price": original_price_el.get_text(strip=True) if original_price_el else "",
                "image_url": image_el.get("src", "") if image_el else "",
                "rating": rating_el.get_text(" ", strip=True) if rating_el else "",
                "review_count": review_el.get_text(" ", strip=True) if review_el else "",
                "is_sponsored": sponsored_el is not None,
                "is_prime": prime_el is not None,
            }

            transformed = self.transform_product(raw_product, category_name, keyword)
            if transformed:
                products.append(transformed)

        has_next_page = soup.select_one(".s-pagination-next:not(.s-pagination-disabled)") is not None
        return products, has_next_page

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
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
            print(f"  Ingestion error: {e}")
            return 0, 0, len(products)

    async def scrape_keyword(
        self, category: dict[str, Any], keyword: str
    ) -> dict[str, int]:
        category_name = category["name"]
        print(f"\n[{category_name}] keyword='{keyword}'")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        for page in range(1, self.max_pages_per_keyword + 1):
            params = {"k": keyword, "page": page}
            html = await self._get_with_retry(f"{BASE_URL}/s", params=params)
            if not html:
                print(f"  Page {page}: request failed")
                break

            parsed_products, has_next_page = self.parse_search_results(html, category_name, keyword)

            fresh_products = []
            for product in parsed_products:
                if product["sku"] in self.seen_asins:
                    continue
                self.seen_asins.add(product["sku"])
                fresh_products.append(product)

            if not fresh_products:
                print(f"  Page {page}: no new products")
                if not has_next_page:
                    break
                await asyncio.sleep(self.delay)
                continue

            for product in fresh_products:
                batch.append(product)
                counts["scraped"] += 1

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

            print(f"  Page {page}: parsed={len(parsed_products)} new={len(fresh_products)} total={counts['scraped']}")

            if page % 5 == 0:
                self._save_session()

            if not has_next_page:
                break

            await asyncio.sleep(self.delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
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
        print("Amazon Japan Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Max pages per keyword: {self.max_pages_per_keyword}")
        print(f"Output: {self.products_outfile}")

        total_keywords = sum(len(c["keywords"]) for c in CATEGORIES)
        print(f"Categories: {len(CATEGORIES)}, Keywords: {total_keywords}")
        print(f"Target: 100,000 products")

        start = time.time()

        for category in CATEGORIES:
            for keyword in category["keywords"]:
                counts = await self.scrape_keyword(category, keyword)
                print(f"  [{category['name']} / {keyword}] Done: {counts}")
                await asyncio.sleep(self.delay)

        elapsed = time.time() - start
        self._save_session()
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "unique_asins": len(self.seen_asins),
        }
        print(f"\nScraper complete: {summary}")
        return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Amazon Japan Scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between requests/batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--max-pages-per-keyword", type=int, default=25)
    parser.add_argument("--session-file", help="Path to session file for resume support")
    parser.add_argument("--proxies", nargs="*", help="List of proxy URLs to rotate through")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = AmazonJPScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        output_dir=args.output_dir,
        max_pages_per_keyword=args.max_pages_per_keyword,
        proxies=args.proxies,
        session_file=args.session_file,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())