"""BuyWhere as a CrewAI tool."""
import os
import requests
from crewai.tools import tool

API = "https://api.buywhere.ai/v1"
H = {"Authorization": f"Bearer {os.environ['BUYWHERE_API_KEY']}"}


@tool("BuyWhere product search")
def buywhere_search(query: str, deliver_to: str = "US") -> str:
    """Search real products across US+SEA marketplaces. Pass deliver_to as the
    end user's ISO country. Each result includes a tracked buy link."""
    r = requests.get(
        f"{API}/products/search",
        params={"q": query, "deliver_to": deliver_to,
                "include_unshippable": "false", "limit": 5},
        headers=H, timeout=30,
    )
    r.raise_for_status()
    return "\n".join(
        f"{p['title']} | {(p.get('price') or {}).get('amount')} "
        f"{(p.get('price') or {}).get('currency')} | {p.get('click_url')}"
        for p in r.json()["data"]
    ) or "no results"
