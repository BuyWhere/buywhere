"""BuyWhere as a LangChain Tool (langchain>=0.2)."""
import os
import requests
from langchain_core.tools import tool

API = "https://api.buywhere.ai/v1"
H = {"Authorization": f"Bearer {os.environ['BUYWHERE_API_KEY']}"}


@tool
def buywhere_search(query: str, deliver_to: str = "US") -> str:
    """Search 300M+ real products. deliver_to = ISO country of the end user
    (required for correct shipping-aware ranking). Returns title, price,
    availability, and a tracked buy link per product."""
    r = requests.get(
        f"{API}/products/search",
        params={"q": query, "deliver_to": deliver_to,
                "include_unshippable": "false", "limit": 5},
        headers=H, timeout=30,
    )
    r.raise_for_status()
    lines = []
    for p in r.json()["data"]:
        price = p.get("price") or {}
        lines.append(
            f"{p['title']} | {price.get('amount')} {price.get('currency')} "
            f"| {p.get('availability')} | buy: {p.get('click_url')}"
        )
    return "\n".join(lines) or "no results"
