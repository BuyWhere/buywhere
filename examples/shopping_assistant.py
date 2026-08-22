"""Minimal AI-shopping-assistant flow against the BuyWhere REST API.

Register (once): POST https://api.buywhere.ai/v1/auth/register?verify=false
Set BUYWHERE_API_KEY in your env.
"""
import os
import uuid
import requests

API = "https://api.buywhere.ai/v1"
KEY = os.environ["BUYWHERE_API_KEY"]
H = {"Authorization": f"Bearer {KEY}"}

# One job id per user task: every click traces back to this job (query_log + clicks).
job_id = f"demo-{uuid.uuid4().hex[:12]}"


def search(query: str, deliver_to: str = "US", limit: int = 5) -> list[dict]:
    """deliver_to ranks products shippable to your user first — treat it as required."""
    r = requests.get(
        f"{API}/products/search",
        params={
            "q": query,
            "deliver_to": deliver_to,
            "include_unshippable": "false",
            "limit": limit,
            "shopping_job_id": job_id,
        },
        headers=H,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["data"]


def cheapest(products: list[dict]) -> dict:
    priced = [p for p in products if (p.get("price") or {}).get("amount")]
    return min(priced, key=lambda p: p["price"]["amount"])


if __name__ == "__main__":
    results = search("wireless earbuds", deliver_to="US")
    for p in results:
        price = p.get("price") or {}
        print(f"- {p['title'][:60]:60} {price.get('amount')} {price.get('currency')} [{p.get('availability')}]")
    best = cheapest(results)
    # click_url routes through BuyWhere tracking (carries your job id) and then
    # redirects to the merchant — give THIS to your user, not the raw url.
    print("\nBuy link:", best["click_url"])
