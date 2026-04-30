"""
BuyWhere Telegram Bot example.

Commands:
  /search <query>
  /deals [min_discount] [limit]
  /compare <product_id_1,product_id_2,...>

Environment:
  TELEGRAM_BOT_TOKEN
  BUYWHERE_API_KEY
  BUYWHERE_API_URL (optional, defaults to https://api.buywhere.ai)
"""

from __future__ import annotations

import html
import logging
import os
from typing import Any

import httpx
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("buywhere.telegram_bot")

BUYWHERE_API_URL = os.environ.get("BUYWHERE_API_URL", "https://api.buywhere.ai").rstrip("/")
BUYWHERE_API_KEY = os.environ.get("BUYWHERE_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
DEFAULT_LIMIT = 5


class BuyWhereAPIError(RuntimeError):
    pass


class BuyWhereClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }

    async def search(self, query: str, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/v1/products",
            params={"q": query, "limit": limit},
        )

    async def deals(self, min_discount: int = 20, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/v1/deals",
            params={"min_discount_pct": min_discount, "limit": limit},
        )

    async def compare(self, product_ids: list[int]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/api/v1/products/compare",
            json={"product_ids": product_ids},
        )

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if not self.api_key:
            raise BuyWhereAPIError("BUYWHERE_API_KEY is not configured.")

        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.request(method, url, headers=self.headers, **kwargs)
        except httpx.HTTPError as exc:
            raise BuyWhereAPIError(f"Request to BuyWhere failed: {exc}") from exc

        if response.status_code >= 400:
            raise BuyWhereAPIError(
                f"BuyWhere returned HTTP {response.status_code}: {response.text[:300]}"
            )

        return response.json()


def build_client() -> BuyWhereClient:
    return BuyWhereClient(BUYWHERE_API_URL, BUYWHERE_API_KEY)


def format_price(value: Any, currency: str = "SGD") -> str:
    if value in (None, ""):
        return "N/A"
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return f"{currency} {value}"
    return f"{currency} {amount:,.2f}"


def product_keyboard(item: dict[str, Any]) -> InlineKeyboardMarkup | None:
    url = item.get("affiliate_url") or item.get("buy_url")
    if not url:
        return None
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton(text="Open listing", url=url)]]
    )


def format_search_result(item: dict[str, Any], index: int) -> str:
    title = html.escape(item.get("name") or "Unknown product")
    source = html.escape(item.get("source") or "unknown")
    brand = html.escape(item.get("brand") or "Unknown brand")
    price = format_price(item.get("price"), item.get("currency") or "SGD")
    return (
        f"<b>{index}. {title}</b>\n"
        f"Brand: {brand}\n"
        f"Price: {html.escape(price)}\n"
        f"Source: {source}"
    )


def format_deal_result(item: dict[str, Any], index: int) -> str:
    title = html.escape(item.get("name") or "Unknown product")
    source = html.escape(item.get("source") or "unknown")
    currency = item.get("currency") or "SGD"
    price = format_price(item.get("price"), currency)
    original_price = item.get("original_price")
    discount_pct = item.get("discount_pct")

    lines = [
        f"<b>{index}. {title}</b>",
        f"Price: {html.escape(price)}",
        f"Source: {source}",
    ]
    if original_price:
        lines.insert(2, f"Was: {html.escape(format_price(original_price, currency))}")
    if discount_pct:
        lines.insert(3 if original_price else 2, f"Discount: {discount_pct}%")
    return "\n".join(lines)


def format_compare_result(comparison: dict[str, Any], index: int) -> str | None:
    matches = comparison.get("matches") or []
    if not matches:
        return None
    cheapest = min(matches, key=lambda item: float(item.get("price") or 0))
    source_name = html.escape(comparison.get("source_product_name") or "Unknown product")
    cheapest_name = html.escape(cheapest.get("name") or "Unknown match")
    cheapest_price = format_price(cheapest.get("price"), cheapest.get("currency") or "SGD")
    cheapest_source = html.escape(cheapest.get("source") or "unknown")
    total_matches = comparison.get("total_matches") or len(matches)
    return (
        f"<b>{index}. {source_name}</b>\n"
        f"Matches: {total_matches}\n"
        f"Cheapest: {cheapest_name}\n"
        f"Best price: {html.escape(cheapest_price)} via {cheapest_source}"
    )


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = (
        "BuyWhere Telegram bot is ready.\n\n"
        "Commands:\n"
        "/search <query> - search products\n"
        "/deals [min_discount] [limit] - show current deals\n"
        "/compare <id1,id2,...> - compare product IDs"
    )
    await update.message.reply_text(message)


async def search_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = " ".join(context.args).strip()
    if not query:
        await update.message.reply_text("Usage: /search <product name>")
        return

    await update.message.reply_text(f"Searching BuyWhere for: {query}")

    try:
        results = await build_client().search(query, limit=DEFAULT_LIMIT)
    except BuyWhereAPIError as exc:
        logger.warning("Search failed: %s", exc)
        await update.message.reply_text(str(exc))
        return

    items = results.get("items") or []
    if not items:
        await update.message.reply_text(f"No products found for: {query}")
        return

    await update.message.reply_text(
        f"Found {results.get('total', len(items))} results for: {query}",
    )

    for index, item in enumerate(items[:DEFAULT_LIMIT], start=1):
        await update.message.reply_text(
            format_search_result(item, index),
            parse_mode=ParseMode.HTML,
            reply_markup=product_keyboard(item),
            disable_web_page_preview=True,
        )


async def deals_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    min_discount = 20
    limit = DEFAULT_LIMIT

    if context.args:
        try:
            min_discount = int(context.args[0])
        except ValueError:
            await update.message.reply_text("Usage: /deals [min_discount] [limit]")
            return
    if len(context.args) > 1:
        try:
            limit = max(1, min(10, int(context.args[1])))
        except ValueError:
            await update.message.reply_text("Usage: /deals [min_discount] [limit]")
            return

    await update.message.reply_text(
        f"Fetching deals with minimum discount {min_discount}%..."
    )

    try:
        results = await build_client().deals(min_discount=min_discount, limit=limit)
    except BuyWhereAPIError as exc:
        logger.warning("Deals request failed: %s", exc)
        await update.message.reply_text(str(exc))
        return

    items = results.get("items") or []
    if not items:
        await update.message.reply_text("No deals found right now.")
        return

    for index, item in enumerate(items[:limit], start=1):
        await update.message.reply_text(
            format_deal_result(item, index),
            parse_mode=ParseMode.HTML,
            reply_markup=product_keyboard(item),
            disable_web_page_preview=True,
        )


async def compare_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    raw_value = " ".join(context.args).strip()
    if not raw_value:
        await update.message.reply_text("Usage: /compare <id1,id2,...>")
        return

    try:
        product_ids = [int(value.strip()) for value in raw_value.split(",") if value.strip()]
    except ValueError:
        await update.message.reply_text("Product IDs must be comma-separated integers.")
        return

    if len(product_ids) < 2:
        await update.message.reply_text("Please provide at least 2 product IDs to compare.")
        return
    if len(product_ids) > 10:
        await update.message.reply_text("Maximum 10 product IDs can be compared at once.")
        return

    await update.message.reply_text(f"Comparing products: {', '.join(map(str, product_ids))}")

    try:
        results = await build_client().compare(product_ids)
    except BuyWhereAPIError as exc:
        logger.warning("Compare request failed: %s", exc)
        await update.message.reply_text(str(exc))
        return

    comparisons = results.get("comparisons") or []
    rendered = [format_compare_result(item, index) for index, item in enumerate(comparisons, start=1)]
    rendered = [item for item in rendered if item]
    if not rendered:
        await update.message.reply_text("No comparison data returned for those product IDs.")
        return

    for block in rendered[:DEFAULT_LIMIT]:
        await update.message.reply_text(block, parse_mode=ParseMode.HTML)


def build_application() -> Application:
    if not TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN must be set before starting the Telegram bot.")

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", start_command))
    application.add_handler(CommandHandler("search", search_command))
    application.add_handler(CommandHandler("deals", deals_command))
    application.add_handler(CommandHandler("compare", compare_command))
    return application


def main() -> None:
    application = build_application()
    logger.info("Starting Telegram bot against %s", BUYWHERE_API_URL)
    application.run_polling()


if __name__ == "__main__":
    main()
