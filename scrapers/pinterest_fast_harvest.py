#!/usr/bin/env python3
"""Fast Pinterest domain harvest — minimal retries, incremental saves, resumable.

Works around Pinterest rate limiting by:
- Single curl_cffi attempt per profile (no fallback APIs, no httpx)
- Saves each result to NDJSON immediately
- Tracks completed profiles so it can be resumed
"""
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

try:
    from curl_cffi import requests as curl_requests
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scrapers.social_pinterest import MERCHANT_SEEDS

OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/social_pinterest")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

NDJSON_PATH = OUTPUT_DIR / "pinterest_discovered.ndjson"
PROGRESS_PATH = OUTPUT_DIR / "harvest_progress.txt"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

SKIP_DOMAINS = {
    "pinterest.com", "pin.it", "linktr.ee", "beacons.ai", "msha.ke",
    "instagram.com", "facebook.com", "twitter.com", "x.com",
    "tiktok.com", "youtube.com", "youtu.be", "t.me", "wa.me",
    "discord.gg", "twitch.tv", "reddit.com", "snapchat.com",
    "amazon.com", "amazon.co", "ebay.com", "etsy.com",
    "onlyfans.com", "patreon.com", "substack.com",
    "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "short.url",
    "app.link",
}


def clean_domain(url: str) -> Optional[str]:
    try:
        if not url or url in ("null", "None", ""):
            return None
        parsed = urlparse(url if "://" in url else f"https://{url}")
        domain = parsed.netloc.lower().strip()
        if domain.startswith("www."):
            domain = domain[4:]
        if domain in SKIP_DOMAINS:
            return None
        for skip in SKIP_DOMAINS:
            if domain.endswith(f".{skip}"):
                return None
        if "." not in domain or len(domain) < 5:
            return None
        return domain
    except Exception:
        return None


def load_progress() -> set:
    if PROGRESS_PATH.exists():
        return set(line.strip() for line in PROGRESS_PATH.read_text().splitlines() if line.strip())
    return set()


def save_progress(username: str) -> None:
    with open(PROGRESS_PATH, "a") as f:
        f.write(f"{username}\n")


def save_ndjson(record: dict) -> None:
    with open(NDJSON_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def harvest_profile(username: str, quick: bool = False) -> Optional[dict]:
    url = f"https://www.pinterest.com/{username}/"

    if not HAS_CURL_CFFI:
        print(f"  curl_cffi not available, skipping {username}")
        return None

    try:
        resp = curl_requests.get(
            url,
            impersonate="chrome124",
            timeout=20,
            verify=False,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
    except Exception as e:
        print(f"  Error: {type(e).__name__}: {str(e)[:80]}")
        return None

    if resp.status_code == 403 or resp.status_code == 429:
        if quick:
            print(f"  Rate limited (HTTP {resp.status_code}), skipping")
            return None
        time.sleep(3)
        try:
            resp = curl_requests.get(
                url, impersonate="chrome124", timeout=20, verify=False,
                headers={"User-Agent": USER_AGENT},
            )
        except Exception:
            return None
        if resp.status_code == 403 or resp.status_code == 429:
            print(f"  Still rate limited, skipping")
            return None

    if resp.status_code != 200:
        print(f"  HTTP {resp.status_code}")
        return None

    html = resp.text
    if not html:
        return None

    # Method 1: regex for domain_url
    domain_match = re.findall(r'"domain_url"\s*:\s*"([^"]+)"', html)
    for raw_domain in domain_match:
        if raw_domain and raw_domain != "null":
            domain = clean_domain(raw_domain)
            if domain:
                return {
                    "domain": domain,
                    "username": username,
                    "source": "pinterest",
                    "extraction_method": "regex_domain_url",
                }

    # Method 2: external_url / website_url patterns
    patterns = [
        r'"external_url"\s*:\s*"([^"]+)"',
        r'"website_url"\s*:\s*"([^"]+)"',
    ]
    for pattern in patterns:
        matches = re.findall(pattern, html, re.IGNORECASE)
        for m in matches:
            if m and m != "null":
                domain = clean_domain(m)
                if domain:
                    return {
                        "domain": domain,
                        "username": username,
                        "source": "pinterest",
                        "extraction_method": f"regex_{pattern.split(':')[0]}",
                    }

    # Method 3: JSON-LD sameAs
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
                        domain = clean_domain(link)
                        if domain:
                            return {
                                "domain": domain,
                                "username": username,
                                "source": "pinterest",
                                "extraction_method": "jsonld_sameas",
                            }
        except (json.JSONDecodeError, KeyError):
            pass

    # Method 4: Try PWS initial state JSON (heavier but richer)
    json_match = re.search(
        r'<script[^>]*id="__PWS_INITIAL_PROPS__"[^>]*>(.*?)</script>',
        html, re.DOTALL
    )
    if json_match:
        try:
            data = json.loads(json_match.group(1))
            if "initialReduxState" in data:
                state = data["initialReduxState"]
                if "resources" in state:
                    for res_key, res_value in state["resources"].items():
                        if not isinstance(res_value, dict):
                            continue
                        for inner_key, inner_value in res_value.items():
                            if isinstance(inner_value, dict) and "data" in inner_value:
                                user_data = inner_value["data"]
                                if isinstance(user_data, dict):
                                    domain_url = user_data.get("domain_url")
                                    if domain_url:
                                        domain = clean_domain(domain_url)
                                        if domain:
                                            return {
                                                "domain": domain,
                                                "username": username,
                                                "source": "pinterest",
                                                "extraction_method": "initial_state",
                                            }
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    return None


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="Skip rate-limited profiles fast")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between profiles")
    args = parser.parse_args()

    completed = load_progress()
    usernames = MERCHANT_SEEDS

    found_count = 0
    skipped_count = 0
    start_time = time.time()

    for i, username in enumerate(usernames):
        if username in completed:
            continue

        print(f"[{i+1}/{len(usernames)}] {username}", end=" ")

        # Short delay to avoid aggressive rate limiting
        if args.delay > 0:
            time.sleep(args.delay)

        result = harvest_profile(username, quick=args.quick)
        save_progress(username)

        if result:
            save_ndjson(result)
            found_count += 1
            print(f"→ {result['domain']} [{result['extraction_method']}]")
        else:
            if "Rate limited" in str(result or ""):
                skipped_count += 1
            print("")

    # Also save unique domain list
    domains_file = OUTPUT_DIR / "pinterest_domains.txt"
    unique_domains = set()
    if NDJSON_PATH.exists():
        with open(NDJSON_PATH) as f:
            for line in f:
                try:
                    r = json.loads(line.strip())
                    unique_domains.add(r["domain"])
                except:
                    pass
    with open(domains_file, "w") as f:
        for d in sorted(unique_domains):
            f.write(f"{d}\n")

    elapsed = time.time() - start_time
    print(f"\n{'='*50}")
    print(f"HARVEST COMPLETE")
    print(f"{'='*50}")
    print(f"Profiles attempted: {len(usernames)}")
    print(f"Domains found:      {found_count}")
    print(f"Rate-limited:       {skipped_count}")
    print(f"Unique domains:     {len(unique_domains)}")
    print(f"Time:               {elapsed:.1f}s")
    print(f"Output NDJSON:      {NDJSON_PATH}")
    print(f"Output domains:     {domains_file}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
