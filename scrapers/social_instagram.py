#!/usr/bin/env python3
"""BUY-17969: Instagram business profile website discovery scraper.

Extracts business_website from Instagram business/creator profiles.
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
from scrapers.social_utils import clean_domain, extract_urls_from_text, fetch_with_curl_cffi


OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/social_instagram")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

# Curated list of Instagram business/creator accounts known to sell products
BUSINESS_SEEDS = [
    # Fashion DTC
    "fashionnova", "revolve", "skims", "goodamerican", "fabletics",
    "aloyoga", "lululemon", "gymshark", "byltbasics", "vuoriclothing",
    "untuckit", "cutsclothing", "bornprimitive", "youngla", "carbon38",
    "setactive", "beyondyoga", "oneractive", "dfyne.official", "nvgtn",
    "alphalete", "ptulaactive", "balanceathletica", "vitality", "tlfsportswear",
    "lspace", "frankiesbikinis", "triangl", "kulani_kinis", "whitefoxboutique",
    "princesspolly", "showpo", "peppermayo", "beginningboutique", "lulus",
    "prettylittlething", "boohoo", "missguided", "nastygal", "iamgia",
    "asos", "ohpolly", "houseofcb", "mistressrocks", "windsorstore",
    # Beauty
    "glossier", "fentybeauty", "rarebeauty", "hauslabs", "kosas",
    "iliabeauty", "merit", "saiehello", "tower28beauty", "westmanatelier",
    "charlottetilbury", "hudabeauty", "anastasiabeverlyhills", "maccosmetics",
    "sephora", "ultabeauty", "morphebrushes", "colourpopcosmetics", "juviasplace",
    "theordinary", "drunkenelephant", "soldejaneiro", "glowrecipe", "farmacybeauty",
    "biossance", "youthtothepeople", "versed", "naturium", "supergoop",
    "olaplex", "k18hair", "briogeo", "ouihair", "amikahaircare",
    "functionofbeauty", "prose",
    # Home/Lifestyle
    "ourplace", "carawayhome", "greatjones", "madeincookware", "misen",
    "yeti", "stanley_brand", "hydroflask", "simplemodern", "owala",
    "brooklinen", "parachutehome", "bollandbranch", "coyuchi", "buffy",
    "article", "burrow", "floydhome", "albanypark", "castlery",
    "ruggable", "westelm", "cb2", "crateandbarrel", "roomandboard",
    "rugsusa", "revivalrugs", "pbteen", "mcgeeandco", "studiosmcgee",
    # Electronics
    "casetify", "dbrand", "peakdesign", "nomadgoods", "satechi",
    "mophie", "anker", "belkin", "mujjo", "moment",
    # Food/Beverage
    "magicspoon", "drinkolipop", "drinkpoppi", "drinkculturepop",
    "dailyharvest", "splendidspoon", "factor_", "blueapron", "hellofresh",
    "flybyjing", "momofuku", "graza", "brightland", "fishwife",
    # Fitness
    "onepeloton", "tonal", "hydrow", "roguefitness", "repfitness",
    "whoop", "ouraring", "theragun", "hyperice", "bala",
    # Pets
    "farmersdog", "ollie", "wildone", "bark", "ruffwear",
    # Jewelry
    "mejuri", "auratenewyork", "vrai", "brilliantearth", "catbirdnyc",
    "missoma", "analuisa", "gorjana", "baublebar", "mvmt",
    # Eyewear
    "warbyparker", "eyebuydirect", "diffeyewear", "goodr", "blenderseyewear",
    # Bags/Luggage
    "away", "monostravel", "beistravel", "paravel", "herschelsupply",
    "dagnedover", "senreve", "loandsons", "cuyana", "statebags",
    # Baby/Kids
    "lovevery", "kiwico_inc", "primarydotcom", "kytebaby", "honest",
    "hellobello", "coterie", "nanit", "owletcare", "doona",
]


class InstagramScraper:
    """Discovers e-commerce websites from Instagram business profiles."""

    def __init__(self, use_proxy: bool = True, delay: float = 2.5, max_retries: int = 3):
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
                    "Referer": "https://www.instagram.com/",
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

    async def _fetch_with_retry(self, url: str) -> Optional[str]:
        """Fetch a URL with retry logic."""
        for attempt in range(self.max_retries):
            try:
                resp = await self.client.get(url)
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
        patterns = [
            r'https?://[^\s<>"\'{}|\\^`\[\]]+',
            r'"external_url"\s*:\s*"([^"]+)"',
            r'"external_url_linkshimmed"\s*:\s*"([^"]+)"',
            r'"website"\s*:\s*"([^"]+)"',
            r'"url"\s*:\s*"([^"]+)"',
        ]
        for pattern in patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for m in matches:
                m = m.strip().rstrip(",.);")
                if m and not any(skip in m.lower() for skip in [
                    "instagram.com", "linktr.ee", "beacons.ai", "msha.ke",
                    "tiktok.com", "youtube.com", "twitter.com", "facebook.com",
                    "wa.me", "t.me", "discord.gg", "onlyfans.com",
                ]):
                    urls.append(m)
        return urls

    def _clean_domain(self, url: str) -> Optional[str]:
        """Extract clean domain from a URL."""
        try:
            parsed = urlparse(url if "://" in url else f"https://{url}")
            domain = parsed.netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]
            skip_patterns = [
                "instagram.com", "linktr.ee", "beacons.ai", "msha.ke",
                "facebook.com", "twitter.com", "x.com", "tiktok.com",
                "youtube.com", "youtu.be", "t.me", "wa.me", "discord.gg",
                "twitch.tv", "reddit.com", "pinterest.com", "snapchat.com",
                "onlyfans.com", "patreon.com", "substack.com",
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
        """Scrape Instagram profile for website link."""
        print(f"  Scraping profile: @{username}")
        await asyncio.sleep(self.delay)

        url = f"https://www.instagram.com/{username}/"
        html = fetch_with_curl_cffi(url, proxy_url=self._proxy, impersonate="chrome124")
        if not html:
            html = await self._fetch_with_retry(url)

        if not html:
            print(f"  No response for @{username}")
            return []

        found = []
        methods_used = set()

        # Method 1: JSON-LD structured data (most reliable)
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
                                    "source": "instagram",
                                    "extraction_method": "jsonld_sameas",
                                })
                                methods_used.add("jsonld_sameas")
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            same_as = item.get("sameAs", [])
                            if isinstance(same_as, list):
                                for link in same_as:
                                    domain = self._clean_domain(link)
                                    if domain:
                                        found.append({
                                            "domain": domain,
                                            "username": username,
                                            "source": "instagram",
                                            "extraction_method": "jsonld_sameas",
                                        })
                                        methods_used.add("jsonld_sameas")
            except (json.JSONDecodeError, KeyError, TypeError):
                pass

        # Method 2: Meta tags
        meta_property_pattern = re.compile(
            r'<meta[^>]*property="([^"]*)"[^>]*content="([^"]*)"',
            re.IGNORECASE
        )
        meta_name_pattern = re.compile(
            r'<meta[^>]*name="([^"]*)"[^>]*content="([^"]*)"',
            re.IGNORECASE
        )

        for pattern in [meta_property_pattern, meta_name_pattern]:
            for m in pattern.finditer(html):
                name = m.group(1).lower()
                content = m.group(2)
                if "url" in name and "og:" in name:
                    domain = self._clean_domain(content)
                    if domain:
                        found.append({
                            "domain": domain,
                            "username": username,
                            "source": "instagram",
                            "extraction_method": f"meta_{name}",
                        })
                        methods_used.add(f"meta_{name}")

        # Method 3: Raw regex for external_url in JSON data
        if not found:
            urls = self._extract_urls_from_text(html)
            for u in urls:
                domain = self._clean_domain(u)
                if domain and domain != "instagram.com":
                    # Deduplicate
                    if domain not in {d["domain"] for d in found}:
                        found.append({
                            "domain": domain,
                            "username": username,
                            "source": "instagram",
                            "extraction_method": "html_fallback",
                        })
                        methods_used.add("html_fallback")

        # Method 4: Try Instagram API endpoint (often works with proper headers)
        if not found:
            api_url = f"https://www.instagram.com/{username}/?__a=1&__d=1"
            api_text = fetch_with_curl_cffi(api_url, proxy_url=self._proxy, impersonate="chrome124")
            if api_text:
                try:
                    data = json.loads(api_text)
                    user = data.get("graphql", {}).get("user", {})
                    if not user:
                        user_data = data.get("data", {}).get("user", {})
                        if user_data:
                            user = user_data
                    ext_url = user.get("external_url") or user.get("external_url_linkshimmed")
                    if ext_url:
                        domain = self._clean_domain(ext_url)
                        if domain:
                            found.append({
                                "domain": domain,
                                "username": username,
                                "source": "instagram",
                                "extraction_method": "graphql_api",
                                "follower_count": user.get("edge_followed_by", {}).get("count", 0),
                                "is_business": user.get("is_business_account", False),
                            })
                            methods_used.add("graphql_api")
                except (json.JSONDecodeError, KeyError):
                    pass
            else:
                # Fallback to httpx API call
                api_headers = {
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    "X-IG-App-ID": "936619743392459",
                }
                for attempt in range(min(2, self.max_retries)):
                    try:
                        resp = await self.client.get(api_url, headers=api_headers)
                        if resp.status_code == 200:
                            try:
                                data = resp.json()
                                user = data.get("graphql", {}).get("user", {})
                                if not user:
                                    user_data = data.get("data", {}).get("user", {})
                                    if user_data:
                                        user = user_data
                                ext_url = user.get("external_url") or user.get("external_url_linkshimmed")
                                if ext_url:
                                    domain = self._clean_domain(ext_url)
                                    if domain:
                                        found.append({
                                            "domain": domain,
                                            "username": username,
                                            "source": "instagram",
                                            "extraction_method": "graphql_api",
                                            "follower_count": user.get("edge_followed_by", {}).get("count", 0),
                                            "is_business": user.get("is_business_account", False),
                                        })
                                        methods_used.add("graphql_api")
                            except (json.JSONDecodeError, KeyError):
                                pass
                            break
                        elif resp.status_code == 404:
                            break
                        else:
                            await asyncio.sleep(2)
                    except Exception:
                        break

        if methods_used:
            print(f"  Found via: {methods_used}")
        if found:
            domains = [r["domain"] for r in found]
            print(f"  Domains: {domains}")

        return found

    async def scrape_usernames(self, usernames: list[str]) -> list[dict]:
        """Scrape multiple Instagram profiles."""
        all_results = []
        for i, username in enumerate(usernames):
            print(f"[{i+1}/{len(usernames)}] @{username}")
            try:
                results = await self.scrape_profile(username)
                all_results.extend(results)
                if not results:
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

        domains_file = OUTPUT_DIR / "instagram_domains.txt"
        unique_domains = sorted(set(r["domain"] for r in results))
        with open(domains_file, "w") as f:
            for d in unique_domains:
                f.write(f"{d}\n")
        print(f"Saved {len(unique_domains)} unique domains to {domains_file}")


async def main():
    parser = argparse.ArgumentParser(description="Instagram business website discovery scraper")
    parser.add_argument("--usernames", nargs="*", help="Specific Instagram usernames to scrape")
    parser.add_argument("--seeds", action="store_true", help="Use built-in seed list")
    parser.add_argument("--no-proxy", action="store_true", help="Disable proxy")
    parser.add_argument("--delay", type=float, default=2.5, help="Delay between requests")
    parser.add_argument("--output", default="instagram_discovered.ndjson", help="Output file")
    args = parser.parse_args()

    if args.usernames:
        usernames = args.usernames
    elif args.seeds:
        usernames = BUSINESS_SEEDS
    else:
        usernames = BUSINESS_SEEDS
        print(f"Using {len(usernames)} seed business profiles")

    scraper = InstagramScraper(
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
