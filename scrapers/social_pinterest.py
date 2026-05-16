#!/usr/bin/env python3
"""BUY-17969: Pinterest merchant domain discovery scraper.

Extracts verified domains from Pinterest merchant/business profiles.
Uses BrightData residential proxies for IP rotation to avoid bot detection.
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scrapers.proxy_config import Zone, proxy_url
from scrapers.social_utils import clean_domain, fetch_with_curl_cffi, fetch_json_with_curl_cffi


OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/social_pinterest")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

# Curated list of Pinterest business/merchant accounts known to sell products
MERCHANT_SEEDS = [
    # Fashion/Apparel
    "fashionnova", "revolve", "skims", "fabletics", "aloyoga",
    "lululemon", "gymshark", "everlane", "reformation", "freepeople",
    "anthropologie", "urbanoutfitters", "asos", "zara", "hm",
    "nordstrom", "bloomingdales", "saksofffifth", "neimanmarcus",
    "ssense", "farfetch", "shopbop", "revolveclothing", "lulus",
    "nastygal", "boohoo", "prettylittlething", "missguided", "showpo",
    "whitefoxboutique", "princesspolly", "beginningboutique",
    # Beauty
    "sephora", "ultabeauty", "dermstore", "skinstore", "glossier",
    "fentybeauty", "rarebeauty", "charlottetilbury", "maccosmetics",
    # Home/Decor
    "westelm", "cb2", "crateandbarrel", "wayfair", "article",
    "burrow", "joybird", "allmodern", "jossandmain", "onekingslane",
    "chairish", "mcgeeandco", "studiosmcgee", "anthropologiehome",
    "brooklinen", "parachutehome", "bollandbranch", "ruggable",
    "castlery", "roveconcepts", "luluandgeorgia",
    # Kitchen/Food
    "ourplace", "carawayhome", "madeincookware", "greatjones",
    "yeti", "hydroflask", "stanley_brand", "lecreuset",
    "williamssonoma", "sur_la_table", "food52", "mouthfoods",
    # Electronics/Lifestyle
    "casetify", "peakdesign", "nomadgoods", "satechi", "anker",
    # Wedding
    "zola", "theknot", "brides", "bhldn", "minted", "riflepaperco",
    # Kids/Baby
    "potterybarnkids", "landofnod", "cratekids", "lovevery",
    "melissaanddoug", "kiwico",
    # Pets
    "chewy", "wildone", "barkbox", "ruffwear",
]


class PinterestScraper:
    """Discovers e-commerce websites from Pinterest merchant profiles."""

    def __init__(self, use_proxy: bool = True, delay: float = 2.0, max_retries: int = 3):
        self.use_proxy = use_proxy
        self.delay = delay
        self.max_retries = max_retries
        self.results: list[dict] = []
        self._client: Optional[httpx.AsyncClient] = None

        proxy = proxy_url(Zone.RESIDENTIAL_PROXY1) if use_proxy else None
        self._proxy = proxy

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                proxy=self._proxy,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Referer": "https://www.pinterest.com/",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    "Sec-Fetch-User": "?1",
                    "Upgrade-Insecure-Requests": "1",
                },
                follow_redirects=True,
            )
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _fetch_with_retry(self, url: str, api: bool = False) -> Optional[str]:
        """Fetch a URL with retry logic."""
        headers = {}
        if api:
            headers["Accept"] = "application/json, text/plain, */*"

        for attempt in range(self.max_retries):
            try:
                resp = await self.client.get(url, headers=headers if headers else None)
                if resp.status_code == 200:
                    return resp.text
                elif resp.status_code == 404:
                    return None
                elif resp.status_code in (429, 403, 503):
                    wait = (2 ** attempt) * 5 + (attempt * 2)
                    print(f"  Rate limited (HTTP {resp.status_code}), waiting {wait}s...")
                    await asyncio.sleep(wait)
                else:
                    print(f"  HTTP {resp.status_code} for {url}")
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return None
            except Exception as e:
                print(f"  Error fetching {url}: {e}")
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        return None

    def _clean_domain(self, url: str) -> Optional[str]:
        """Extract clean domain from a URL."""
        try:
            parsed = urlparse(url if "://" in url else f"https://{url}")
            domain = parsed.netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]
            skip_patterns = [
                "pinterest.com", "pin.it", "linktr.ee", "beacons.ai", "msha.ke",
                "instagram.com", "facebook.com", "twitter.com", "x.com",
                "tiktok.com", "youtube.com", "youtu.be", "t.me", "wa.me",
                "discord.gg", "twitch.tv", "reddit.com", "snapchat.com",
                "amazon.com", "amazon.co", "ebay.com", "etsy.com",
            ]
            for p in skip_patterns:
                if domain == p or domain.endswith(f".{p}"):
                    return None
            if "." not in domain or len(domain) < 5:
                return None
            return domain
        except Exception:
            return None

    async def scrape_profile(self, username: str) -> list[dict]:
        """Scrape Pinterest profile for verified domain."""
        print(f"  Scraping profile: {username}")
        await asyncio.sleep(self.delay)

        url = f"https://www.pinterest.com/{username}/"
        html = fetch_with_curl_cffi(url, proxy_url=self._proxy, impersonate="chrome124")
        if not html:
            html = await self._fetch_with_retry(url)

        if not html:
            print(f"  No response for {username}")
            return []

        found = []

        # Method 1: Simple regex for domain_url (fastest, most reliable)
        domain_match = re.findall(r'"domain_url"\s*:\s*"([^"]+)"', html)
        for raw_domain in domain_match:
            if raw_domain and raw_domain != "null":
                domain = self._clean_domain(raw_domain)
                if domain:
                    found.append({
                        "domain": domain,
                        "username": username,
                        "source": "pinterest",
                        "extraction_method": "regex_domain_url",
                    })
                    break  # one domain per profile

        # Method 2: Extract from __PWS_INITIAL_PROPS__ JSON for richer metadata
        json_match = None
        if not found:
            json_match = re.search(
                r'<script[^>]*id="__PWS_INITIAL_PROPS__"[^>]*>(.*?)</script>',
                html, re.DOTALL
            )

        if not json_match:
            # Try alternative: window.__INITIAL_STATE__ 
            json_match = re.search(
                r'<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.*?});</script>',
                html, re.DOTALL
            )

        if json_match:
            try:
                data = json.loads(json_match.group(1))
                # Path: initialReduxState -> resources -> UserResource -> {complex_key} -> data
                if "initialReduxState" in data:
                    state = data["initialReduxState"]
                    if "resources" in state:
                        resources = state["resources"]
                        for res_key, res_value in resources.items():
                            if not isinstance(res_value, dict):
                                continue
                            # Pinterest uses stringified JSON arrays as resource keys
                            # Each resource value is a dict mapping complex_key -> {data: ...}
                            for inner_key, inner_value in res_value.items():
                                if isinstance(inner_value, dict) and "data" in inner_value:
                                    user_data = inner_value["data"]
                                    if isinstance(user_data, dict):
                                        domain_url = user_data.get("domain_url")
                                        if domain_url:
                                            domain = self._clean_domain(domain_url)
                                            if domain:
                                                found.append({
                                                    "domain": domain,
                                                    "username": username,
                                                    "source": "pinterest",
                                                    "extraction_method": "initial_state",
                                                    "is_verified_merchant": user_data.get(
                                                        "is_verified_merchant",
                                                        user_data.get("verified_identity", {}).get("verified", False)
                                                    ),
                                                    "follower_count": user_data.get("follower_count", 0),
                                                })
                                            break  # found domain for this resource
                                if found:
                                    break
                            if found:
                                break

                # Alternative path: store -> user
                if not found and "store" in data:
                    store = data.get("store", {})
                    user = store.get("user", {})
                    domain_url = user.get("domain_url")
                    if domain_url:
                        domain = self._clean_domain(domain_url)
                        if domain:
                            found.append({
                                "domain": domain,
                                "username": username,
                                "source": "pinterest",
                                "extraction_method": "store_user",
                            })

                # Path from resourceResponses
                if not found and "resourceResponses" in data:
                    for resp in data.get("resourceResponses", []):
                        resp_data = resp.get("response", {}).get("data", {})
                        domain_url = resp_data.get("domain_url")
                        if domain_url:
                            domain = self._clean_domain(domain_url)
                            if domain:
                                found.append({
                                    "domain": domain,
                                    "username": username,
                                    "source": "pinterest",
                                    "extraction_method": "resource_response",
                                })

            except (json.JSONDecodeError, KeyError, TypeError):
                pass

        # Method 2: Meta tags for og:see_also (common on Pinterest)
        if not found:
            meta_match = re.findall(
                r'<meta[^>]*property="og:see_also"[^>]*content="([^"]+)"',
                html, re.IGNORECASE
            )
            for m in meta_match:
                domain = self._clean_domain(m)
                if domain:
                    found.append({
                        "domain": domain,
                        "username": username,
                        "source": "pinterest",
                        "extraction_method": "meta_see_also",
                    })

        # Method 3: JSON-LD structured data
        if not found:
            jsonld_match = re.search(
                r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                html, re.DOTALL
            )
            if jsonld_match:
                try:
                    data = json.loads(jsonld_match.group(1))
                    if isinstance(data, dict):
                        same_as = data.get("sameAs", [])
                        if isinstance(same_as, list):
                            for link in same_as:
                                domain = self._clean_domain(link)
                                if domain:
                                    found.append({
                                        "domain": domain,
                                        "username": username,
                                        "source": "pinterest",
                                        "extraction_method": "jsonld",
                                    })
                except (json.JSONDecodeError, KeyError):
                    pass

        # Method 4: Pinterest resource API (fallback) - try curl_cffi first
        if not found:
            api_options = {"source_url": f"/{username}/"}
            api_url = (
                "https://www.pinterest.com/resource/UserResource/get/"
                f"?source_url=/{username}/&data="
                f"{json.dumps({'options': api_options})}"
            )
            api_data = fetch_json_with_curl_cffi(api_url, proxy_url=self._proxy)
            if api_data:
                user_data = (
                    api_data.get("resource_response", {})
                    .get("data", {})
                )
                domain_url = user_data.get("domain_url")
                if domain_url:
                    domain = self._clean_domain(domain_url)
                    if domain:
                        found.append({
                            "domain": domain,
                            "username": username,
                            "source": "pinterest",
                            "extraction_method": "resource_api",
                            "is_verified_merchant": user_data.get("verified_identity", {}).get("verified", False),
                        })
            else:
                # Fallback to httpx
                api_text = await self._fetch_with_retry(api_url, api=True)
                if api_text:
                    try:
                        api_data = json.loads(api_text)
                        user_data = (
                            api_data.get("resource_response", {})
                            .get("data", {})
                        )
                        domain_url = user_data.get("domain_url")
                        if domain_url:
                            domain = self._clean_domain(domain_url)
                            if domain:
                                found.append({
                                    "domain": domain,
                                    "username": username,
                                    "source": "pinterest",
                                    "extraction_method": "resource_api",
                                    "is_verified_merchant": user_data.get("verified_identity", {}).get("verified", False),
                                })
                    except (json.JSONDecodeError, KeyError):
                        pass

        # Method 5: Raw regex on HTML for domain_url patterns
        if not found:
            patterns = [
                r'"domain_url"\s*:\s*"([^"]+)"',
                r'"external_url"\s*:\s*"([^"]+)"',
                r'"website_url"\s*:\s*"([^"]+)"',
            ]
            for pattern in patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for m in matches:
                    if m and m != "null":
                        domain = self._clean_domain(m)
                        if domain:
                            found.append({
                                "domain": domain,
                                "username": username,
                                "source": "pinterest",
                                "extraction_method": f"regex_{pattern.split(':')[0]}",
                            })
                            break
                if found:
                    break

        if found:
            domains = [r["domain"] for r in found]
            methods = set(r.get("extraction_method", "") for r in found)
            print(f"  Found via {methods}: {domains}")

        return found

    async def scrape_usernames(self, usernames: list[str]) -> list[dict]:
        """Scrape multiple Pinterest profiles."""
        all_results = []
        for i, username in enumerate(usernames):
            print(f"[{i+1}/{len(usernames)}] {username}")
            try:
                results = await self.scrape_profile(username)
                all_results.extend(results)
                if not results:
                    print(f"  No verified domain found")
            except Exception as e:
                print(f"  Error: {e}")
        return all_results

    def save_results(self, results: list[dict], output_file: str) -> None:
        """Save results to NDJSON."""
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        filepath = OUTPUT_DIR / output_file
        with open(filepath, "w", encoding="utf-8") as f:
            for r in results:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"\nSaved {len(results)} results to {filepath}")

        domains_file = OUTPUT_DIR / "pinterest_domains.txt"
        unique_domains = sorted(set(r["domain"] for r in results))
        with open(domains_file, "w") as f:
            for d in unique_domains:
                f.write(f"{d}\n")
        print(f"Saved {len(unique_domains)} unique domains to {domains_file}")


async def main():
    parser = argparse.ArgumentParser(description="Pinterest merchant domain discovery scraper")
    parser.add_argument("--usernames", nargs="*", help="Specific Pinterest usernames to scrape")
    parser.add_argument("--seeds", action="store_true", help="Use built-in seed list")
    parser.add_argument("--no-proxy", action="store_true", help="Disable proxy")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between requests")
    parser.add_argument("--output", default="pinterest_discovered.ndjson", help="Output file")
    args = parser.parse_args()

    if args.usernames:
        usernames = args.usernames
    elif args.seeds:
        usernames = MERCHANT_SEEDS
    else:
        usernames = MERCHANT_SEEDS
        print(f"Using {len(usernames)} seed merchant profiles")

    scraper = PinterestScraper(
        use_proxy=not args.no_proxy,
        delay=args.delay,
    )

    try:
        results = await scraper.scrape_usernames(usernames)
        scraper.save_results(results, args.output)

        unique_domains = sorted(set(r["domain"] for r in results))
        methods = set(r.get("extraction_method", "unknown") for r in results)
        print(f"\n{'='*50}")
        print(f"DISCOVERY SUMMARY")
        print(f"{'='*50}")
        print(f"Profiles scraped:    {len(usernames)}")
        print(f"Websites found:      {len(results)}")
        print(f"Unique domains:      {len(unique_domains)}")
        print(f"Extraction methods:  {methods}")
        print(f"{'='*50}")
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
