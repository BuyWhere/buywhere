#!/usr/bin/env python3
"""
r408 — Multi-niche US Shopify discovery round
Verticals: candle_making, beekeeping, printmaking, fly_fishing,
           homebrew_supplies, leathercraft
"""
import json
import subprocess
import sys
import time
import os

SECRETS = json.load(open("/home/paperclip/.secrets/fleet-secrets.json"))
PERPLEXITY_KEY = SECRETS["PERPLEXITY_API_KEY"]
RUN_ID = os.environ.get("PAPERCLIP_RUN_ID", "r408")
OUTFILE = "/home/paperclip/buywhere/data/shopper_batches/r408_batch191_netnew.json"

NICHE_PROMPTS = {
    "candle_making": (
        "Find 5-10 active US Shopify stores selling candle making supplies, "
        "candle wax, fragrance oils, wicks, or soap making DIY kits. "
        "Small independent businesses. Return ONLY a JSON array of domain strings "
        "like [\"example.com\",\"shop.mystore.com\"] — no explanation, no markdown."
    ),
    "beekeeping": (
        "Find 5-10 active US Shopify stores selling beekeeping supplies, "
        "honey bee equipment, hive tools, beekeeper suits, or apiary products. "
        "Small independent US beekeeping businesses. "
        "Return ONLY a JSON array of domain strings."
    ),
    "printmaking": (
        "Find 5-10 active US Shopify stores selling printmaking supplies, "
        "lino-cut tools, etching equipment, artist printing supplies, "
        "or block printing materials. Small independent printmaking shops. "
        "Return ONLY a JSON array of domain strings."
    ),
    "fly_fishing": (
        "Find 5-10 active US Shopify stores selling fly fishing gear, "
        "fly tying materials, fly fishing flies, or fly fishing accessories. "
        "Small independent fly fishing shops. "
        "Return ONLY a JSON array of domain strings."
    ),
    "homebrew_supplies": (
        "Find 5-10 active US Shopify stores selling homebrewing beer supplies, "
        "wine making equipment, fermentation kits, or brewing ingredients. "
        "Small independent homebrew shops. "
        "Return ONLY a JSON array of domain strings."
    ),
    "leathercraft": (
        "Find 5-10 active US Shopify stores selling leathercraft supplies, "
        "leather hides, leather tools, leather stitching supplies, "
        "or leather working kits. Small independent leathercraft shops. "
        "Return ONLY a JSON array of domain strings."
    ),
}


def query_perplexity(prompt: str) -> list[str]:
    payload = {
        "model": "sonar",
        "messages": [
            {"role": "system", "content": "You are a research assistant. Return ONLY a JSON array of domain strings."},
            {"role": "user", "content": prompt},
        ],
    }
    cmd = [
        "curl", "-s", "-X", "POST",
        "https://api.perplexity.ai/chat/completions",
        "-H", f"Authorization: Bearer {PERPLEXITY_KEY}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(payload),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        d = json.loads(result.stdout)
        content = d.get("choices", [{}])[0].get("message", {}).get("content", "[]")
        return json.loads(content)
    except Exception:
        return []


def check_shopify(domain: str) -> dict:
    """Quick Shopify /products.json probe."""
    url = f"https://{domain}/products.json?limit=1"
    cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    status = r.stdout.strip()
    return {"domain": domain, "shopify_status": status, "is_shopify": status == "200"}


results = {}
validated = []
all_domains_seen = set()

print(f"r408 discovery starting at {time.strftime('%H%M%SZ', time.gmtime())}")
print(f"Run ID: {RUN_ID}")

for niche, prompt in NICHE_PROMPTS.items():
    print(f"=== {niche} ===")
    domains = query_perplexity(prompt)
    results[niche] = domains
    print(f"  Raw: {domains}")
    time.sleep(1)

    for domain in domains:
        if domain in all_domains_seen:
            continue
        all_domains_seen.add(domain)
        check = check_shopify(domain)
        print(f"  Shopify check {domain}: {check['shopify_status']}")
        if check["is_shopify"]:
            validated.append({**check, "niche": niche})
    time.sleep(0.5)

print(f"\nDiscovery done. {len(validated)} Shopify-positive candidates.")
print(f"Total unique domains probed: {len(all_domains_seen)}")

output = {
    "run_id": RUN_ID,
    "batch": "r408_batch191",
    "timestamp": time.strftime("%Y-%m-%dT%H%M%SZ", time.gmtime()),
    "niches_queried": list(NICHE_PROMPTS.keys()),
    "raw_discoveries": results,
    "validated_shopify": validated,
    "total_validated": len(validated),
}

with open(OUTFILE, "w") as f:
    json.dump(output, f, indent=2)

print(f"Written: {OUTFILE} ({os.path.getsize(OUTFILE)} bytes)")

# Print summary
for v in validated:
    print(f"  [{v['niche']}] {v['domain']}")
