"""
BuyWhere Slack Bot — product search example using Slack Bolt.

This bot responds to the /search slash command with formatted
product results as Slack blocks.

Usage:
    export SLACK_BOT_TOKEN=xoxb-...
    export SLACK_SIGNING_SECRET=xxx
    export BUYWHERE_API_KEY=bw_live_...
    python app.py
"""
import os
import logging
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = App(
    token=os.environ.get("SLACK_BOT_TOKEN"),
    signing_secret=os.environ.get("SLACK_SIGNING_SECRET"),
)

BUYWHERE_API_KEY = os.environ.get("BUYWHERE_API_KEY", "")
BUYWHERE_BASE_URL = os.environ.get("BUYWHERE_BASE_URL", "https://api.buywhere.ai")


def search_products(query: str, limit: int = 5):
    """Search products via BuyWhere API."""
    import httpx
    headers = {"Authorization": f"Bearer {BUYWHERE_API_KEY}"}
    params = {"q": query, "limit": limit}

    try:
        resp = httpx.get(
            f"{BUYWHERE_BASE_URL}/v1/products/search",
            headers=headers,
            params=params,
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.error(f"Search failed: {e}")
        return None


def format_price(price: float, currency: str) -> str:
    """Format price for display."""
    if currency == "SGD":
        return f"${price:.2f}"
    elif currency == "IDR":
        return f"Rp {price:,.0f}"
    elif currency == "MYR":
        return f"RM {price:.2f}"
    elif currency == "THB":
        return f"฿ {price:.2f}"
    elif currency == "VND":
        return f"₫ {price:,.0f}"
    elif currency == "PHP":
        return f"₱ {price:.2f}"
    else:
        return f"{price:.2f} {currency}"


def build_slack_blocks(products: list) -> list:
    """Build Slack block kit for product list."""
    blocks = []

    for product in products:
        price = product.get("price", 0)
        currency = product.get("currency", "SGD")
        original_price = product.get("metadata", {}).get("original_price", price)
        discount_pct = product.get("metadata", {}).get("discount_pct", 0)
        title = product.get("name", "Unknown Product")
        url = product.get("buy_url", "")
        image_url = product.get("image_url", "")
        brand = product.get("brand", "")
        source = product.get("source", "")

        price_text = format_price(price, currency)

        if discount_pct > 0:
            orig_text = format_price(original_price, currency)
            price_text = f"{price_text} ~~{orig_text}~~ ({discount_pct}% off)"

        header = f"*{title}*"
        if brand:
            header = f"*{title}*\n_{brand}_"

        elements = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{header}\n{price_text}\n_{source}_",
                },
            }
        ]

        if image_url:
            elements[0]["accessory"] = {
                "type": "image",
                "image_url": image_url,
                "alt_text": title,
            }

        blocks.extend(elements)
        blocks.append({"type": "divider"})

    return blocks


@app.command("/search")
def handle_search(ack, body, client, logger):
    """Handle /search slash command."""
    ack()
    query = body.get("text", "").strip()

    if not query:
        client.views_open(
            trigger_id=body["trigger_id"],
            view={
                "type": "modal",
                "title": {"type": "plain_text", "text": "Product Search"},
                "close": {"type": "plain_text", "text": "Close"},
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "Please provide a search query.\nUsage: `/search <product name>`",
                        },
                    }
                ],
            },
        )
        return

    logger.info(f"Searching for: {query}")

    results = search_products(query, limit=5)

    if not results or results.get("total", 0) == 0:
        client.chat_postMessage(
            channel=body["channel_id"],
            text=f"No products found for '{query}'",
        )
        return

    items = results.get("items", [])
    blocks = build_slack_blocks(items)

    header = {
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": f"🔍 *Search results for '{query}'* — {results.get('total', 0)} found",
        },
    }
    blocks.insert(0, header)

    try:
        client.chat_postMessage(
            channel=body["channel_id"],
            blocks=blocks,
            text=f"Search results for {query}",
        )
    except Exception as e:
        logger.error(f"Failed to post message: {e}")
        client.chat_postMessage(
            channel=body["channel_id"],
            text=f"Error searching for '{query}': {str(e)}",
        )


@app.event("app_mention")
def handle_app_mention(event, client, logger):
    """Handle app mention events."""
    text = event.get("text", "")
    logger.info(f"App mentioned with text: {text}")

    if "/search" in text:
        query = text.split("/search")[-1].strip()
        if query:
            results = search_products(query, limit=3)
            if results and results.get("total", 0) > 0:
                items = results.get("items", [])
                blocks = build_slack_blocks(items)
                header = {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"🔍 *Search results for '{query}'*",
                    },
                }
                blocks.insert(0, header)
                client.chat_postMessage(
                    channel=event["channel"],
                    blocks=blocks,
                    text=f"Search results for {query}",
                )


if __name__ == "__main__":
    handler = SocketModeHandler(app)
    handler.start()