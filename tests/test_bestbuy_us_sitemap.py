import sys
from pathlib import Path

import pytest

sys.path.insert(0, "/home/paperclip/buywhere-api")

from scrapers.bestbuy_us_sitemap import BestBuyUSSitemapScraper


@pytest.mark.asyncio
async def test_collect_all_urls_tracks_seen_after_returned_urls():
    scraper = BestBuyUSSitemapScraper(scrape_only=True, data_dir=str(Path("/tmp/bestbuy-us-test")))

    async def fake_collect_urls_from_page(category, page=1):
        if page == 1:
            return [
                "https://www.bestbuy.com/site/test-product/1234567.p?skuId=1234567",
                "https://www.bestbuy.com/site/test-product/7654321.p?skuId=7654321",
            ], True
        return [], False

    scraper._collect_urls_from_category_page = fake_collect_urls_from_page  # type: ignore[method-assign]

    try:
        urls = await scraper.collect_all_urls(
            {"id": "computers-laptops", "name": "Computers", "sub": "Laptops"}
        )
    finally:
        await scraper.close()

    assert len(urls) == 2
    assert scraper.total_urls_collected == 2
    assert set(urls) == scraper.seen_urls


def test_extract_product_urls_deduplicates_within_page_without_marking_seen():
    scraper = BestBuyUSSitemapScraper(scrape_only=True, data_dir=str(Path("/tmp/bestbuy-us-test")))
    html = """
    <html>
      <body>
        <a href="/site/test-product/1234567.p?skuId=1234567">One</a>
        <a href="/site/test-product/1234567.p?skuId=1234567">One duplicate</a>
        <div data-sku-id="7654321"></div>
        <div data-sku-id="7654321"></div>
      </body>
    </html>
    """

    try:
        urls = scraper._extract_product_urls_from_page(html)
    finally:
        import asyncio

        asyncio.run(scraper.close())

    assert urls == [
        "https://www.bestbuy.com/site/test-product/1234567.p?skuId=1234567",
        "https://www.bestbuy.com/site/product?skuId=7654321",
    ]
    assert scraper.seen_urls == set()


def test_product_from_sitemap_url_derives_normalized_record():
    scraper = BestBuyUSSitemapScraper(scrape_only=True, data_dir=str(Path("/tmp/bestbuy-us-test")))
    url = "https://www.bestbuy.com/site/sony-xb650bt-over-the-ear-wireless-headphones-blue/4833502.p?skuId=4833502"

    try:
        product = scraper._product_from_sitemap_url(url)
    finally:
        import asyncio

        asyncio.run(scraper.close())

    assert product is not None
    assert product["sku"] == "4833502"
    assert product["merchant_id"] == "bestbuy_us"
    assert product["title"] == "Sony Xb650bt Over The Ear Wireless Headphones Blue"
    assert product["currency"] == "USD"
    assert product["category"] == "Audio"
    assert product["metadata"]["extraction_method"] == "bestbuy_pdp_sitemap"
    assert product["metadata"]["price_available"] is False
