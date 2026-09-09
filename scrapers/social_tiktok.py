#!/usr/bin/env python3
"""BUY-17969: TikTok Shop seller website discovery scraper.

Extracts external_website fields from TikTok Shop seller profiles.
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
from scrapers.social_utils import clean_domain, extract_urls_from_text, fetch_with_curl_cffi, fetch_json_with_curl_cffi


OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/social_tiktok")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

# Known TikTok seller profiles (curated list of probable e-commerce sellers)
# These are TikTok accounts with "Shop" or "Store" in their bio that likely have websites
SELLER_SEEDS = [
    # Fashion
    "fashionnova", "shein_official", "zara", "hm", "boohoo",
    "prettylittlething", "asos", "skims", "fabletics", "aloyoga",
    "lululemon", "gymshark", "fashionvalet", "lovebonito",
    # Beauty
    "fentybeauty", "rarebeauty", "glossier", "sephora", "ultabeauty",
    "theordinary", "drunkenelephant", "soldejaneiro", "kosas",
    # Home/Lifestyle
    "ourplace", "yeti", "stanleybrand", "hydroflask", "brooklinen",
    # Electronics
    "casetify", "dbrand", "popsocket", "otterbox",
    # Food/Beverage
    "olipop", "poppi", "magicspoon", "dailyharvest",
    # Fitness
    "peloton", "roguefitness", "nobull",
]


class TikTokScraper:
    """Discovers e-commerce websites from TikTok seller profiles."""

    def __init__(self, use_proxy: bool = True, delay: float = 2.0, max_retries: int = 3):
        self.use_proxy = use_proxy
        self.delay = delay
        self.max_retries = max_retries
        self.results: list[dict] = []
        self._client: Optional[httpx.AsyncClient] = None

        if use_proxy:
            proxy = proxy_url(Zone.RESIDENTIAL_PROXY1)
        else:
            proxy = None

        self._proxy = proxy

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                proxy=self._proxy,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Referer": "https://www.tiktok.com/",
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

    def _extract_urls_from_text(self, text: str) -> list[str]:
        """Extract URLs from raw text using regex."""
        urls = []
        # Common URL patterns
        url_patterns = [
            r'https?://[^\s<>"\'{}|\\^`\[\]]+',
            r'"external_website"\s*:\s*"([^"]+)"',
            r'"link"\s*:\s*"([^"]+)"',
        ]
        for pattern in url_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for m in matches:
                m = m.strip().rstrip(",.);")
                if m and not any(skip in m.lower() for skip in [
                    "tiktok.com", "linktr.ee", "beacons.ai", "msha.ke",
                    "youtube.com", "twitter.com", "facebook.com", "instagram.com",
                    "wa.me", "t.me",
                ]):
                    urls.append(m)
        return urls

    def _clean_domain(self, url: str) -> Optional[str]:
        """Extract clean domain from a URL."""
        try:
            parsed = urlparse(url if "://" in url else f"https://{url}")
            domain = parsed.netloc.lower()
            # Remove www prefix
            if domain.startswith("www."):
                domain = domain[4:]
            # Skip non-commercial domains
            skip_patterns = [
                "tiktok.com", "linktr.ee", "beacons.ai", "msha.ke",
                "instagram.com", "facebook.com", "twitter.com", "x.com",
                "youtube.com", "youtu.be", "t.me", "wa.me", "discord.gg",
                "twitch.tv", "reddit.com", "pinterest.com", "snapchat.com",
                "amazon.com", "amazon.co", "ebay.com", "etsy.com",
            ]
            for p in skip_patterns:
                if domain == p or domain.endswith(f".{p}"):
                    return None
            # Must have a valid TLD
            if "." not in domain or len(domain) < 5:
                return None
            return domain
        except Exception:
            return None

    def _strip_functions(self):
        """Remove curl_cffi backed fetch (replaced by direct call)."""
        pass

    async def scrape_profile_html(self, username: str) -> list[dict]:
        """Scrape TikTok profile via HTML page (primary method)."""
        print(f"  Scraping profile: @{username}")
        await asyncio.sleep(self.delay)

        # TikTok profile page — try curl_cffi first for TLS impersonation
        url = f"https://www.tiktok.com/@{username}"
        html = fetch_with_curl_cffi(url, proxy_url=self._proxy, impersonate="chrome124")
        if not html:
            html = await self._fetch_with_retry(url)

        if not html:
            print(f"  No response for @{username}")
            return []

        found = []

        # Try to extract the __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON blob
        match = re.search(
            r'<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>',
            html, re.DOTALL
        )
        if match:
            try:
                data = json.loads(match.group(1))
                # Navigate TikTok's internal data structure
                user_module = (
                    data.get("__DEFAULT_SCOPE__", {})
                    .get("webapp.user-detail", {})
                )
                user_info = user_module.get("userInfo", {})
                user = user_info.get("user", {})

                # Extract bio_link
                bio_link = user.get("bioLink", {})
                if bio_link and isinstance(bio_link, dict):
                    link_url = bio_link.get("link", "")
                    if link_url:
                        domain = self._clean_domain(link_url)
                        if domain:
                            found.append({
                                "domain": domain,
                                "username": username,
                                "source": "tiktok",
                                "extraction_method": "bio_link",
                                "follower_count": user.get("followerCount", 0),
                                "verified": user.get("verified", False),
                            })

                # Extract bio description for URLs
                bio = user.get("signature", "") or user.get("bioDescription", "")
                if bio:
                    urls = self._extract_urls_from_text(bio)
                    for u in urls:
                        domain = self._clean_domain(u)
                        if domain and domain not in {d["domain"] for d in found}:
                            found.append({
                                "domain": domain,
                                "username": username,
                                "source": "tiktok",
                                "extraction_method": "bio_text",
                                "follower_count": user.get("followerCount", 0),
                                "verified": user.get("verified", False),
                            })

            except (json.JSONDecodeError, KeyError, TypeError):
                pass

        # Fallback: raw regex on full HTML for any external links
        if not found:
            urls = self._extract_urls_from_text(html)
            for u in urls:
                domain = self._clean_domain(u)
                if domain and domain not in {d["domain"] for d in found}:
                    found.append({
                        "domain": domain,
                        "username": username,
                        "source": "tiktok",
                        "extraction_method": "html_fallback",
                        "follower_count": 0,
                        "verified": False,
                    })

        return found

    async def scrape_profile_api(self, username: str) -> list[dict]:
        """Scrape TikTok profile via internal API (fallback method)."""
        await asyncio.sleep(self.delay)

        api_url = f"https://www.tiktok.com/api/user/detail/?uniqueId={username}"
        text = fetch_with_curl_cffi(api_url, proxy_url=self._proxy, impersonate="chrome124")
        if not text:
            text = await self._fetch_with_retry(api_url, api=True)

        if not text:
            return []

        found = []
        try:
            data = json.loads(text)
            user_info = data.get("userInfo", {})
            user = user_info.get("user", {})

            bio_link = user.get("bioLink", {})
            if isinstance(bio_link, dict):
                link_url = bio_link.get("link", "")
                if link_url:
                    domain = self._clean_domain(link_url)
                    if domain:
                        found.append({
                            "domain": domain,
                            "username": username,
                            "source": "tiktok",
                            "extraction_method": "api_bio_link",
                            "follower_count": user.get("followerCount", 0),
                            "verified": user.get("verified", False),
                        })

            bio = user.get("signature", "")
            if bio:
                urls = self._extract_urls_from_text(bio)
                for u in urls:
                    domain = self._clean_domain(u)
                    if domain and domain not in {d["domain"] for d in found}:
                        found.append({
                            "domain": domain,
                            "username": username,
                            "source": "tiktok",
                            "extraction_method": "api_bio_text",
                            "follower_count": user.get("followerCount", 0),
                            "verified": user.get("verified", False),
                        })

        except (json.JSONDecodeError, KeyError, TypeError):
            pass

        return found

    async def scrape_profile(self, username: str) -> list[dict]:
        """Scrape a single TikTok profile, trying multiple methods."""
        # Try HTML first (richer data)
        results = await self.scrape_profile_html(username)
        if results:
            return results

        # Fallback to API
        results = await self.scrape_profile_api(username)
        return results

    async def scrape_usernames(self, usernames: list[str]) -> list[dict]:
        """Scrape multiple TikTok profiles."""
        all_results = []
        for i, username in enumerate(usernames):
            print(f"[{i+1}/{len(usernames)}] @{username}")
            try:
                results = await self.scrape_profile(username)
                all_results.extend(results)
                if results:
                    domains = [r["domain"] for r in results]
                    print(f"  Found: {domains}")
                else:
                    print(f"  No website found")
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

        # Also save a simple domain list
        domains_file = OUTPUT_DIR / "tiktok_domains.txt"
        unique_domains = sorted(set(r["domain"] for r in results))
        with open(domains_file, "w") as f:
            for d in unique_domains:
                f.write(f"{d}\n")
        print(f"Saved {len(unique_domains)} unique domains to {domains_file}")


async def main():
    parser = argparse.ArgumentParser(description="TikTok seller website discovery scraper")
    parser.add_argument("--usernames", nargs="*", help="Specific TikTok usernames to scrape")
    parser.add_argument("--seeds", action="store_true", help="Use built-in seed list")
    parser.add_argument("--no-proxy", action="store_true", help="Disable proxy")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between requests")
    parser.add_argument("--output", default="tiktok_discovered.ndjson", help="Output file")
    args = parser.parse_args()

    if args.usernames:
        usernames = args.usernames
    elif args.seeds:
        usernames = SELLER_SEEDS
    else:
        usernames = SELLER_SEEDS
        print(f"Using {len(usernames)} seed seller profiles")

    scraper = TikTokScraper(
        use_proxy=not args.no_proxy,
        delay=args.delay,
    )

    try:
        results = await scraper.scrape_usernames(usernames)
        scraper.save_results(results, args.output)

        # Summary
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
