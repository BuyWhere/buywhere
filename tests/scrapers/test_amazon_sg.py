import pytest

from scrapers import amazon_sg


@pytest.fixture(autouse=True)
def brightdata_env(monkeypatch):
    monkeypatch.setenv("BRIGHTDATA_DATACENTER_USERNAME", "brd-customer-hl_3ab737be-zone-datacenter_proxy1")
    monkeypatch.setenv("BRIGHTDATA_ZONE_PASSWORD", "secret")
    monkeypatch.setenv("BRIGHTDATA_DATACENTER_HOST", "brd.superproxy.io")
    monkeypatch.setenv("BRIGHTDATA_DATACENTER_PORT", "30000")
    from scrapers.proxy_config import clear_cache

    clear_cache()


@pytest.mark.asyncio
async def test_dry_run_uses_datacenter_proxy_and_enforces_limit(tmp_path):
    scraper = amazon_sg.AmazonSGScraper(dry_run=True, output_dir=str(tmp_path), max_products=5)
    try:
        assert "datacenter_proxy1" in scraper.proxy
        assert scraper.max_products == 5
        assert scraper.scrape_only is True
        assert scraper.dry_run is True
    finally:
        await scraper.close()


@pytest.mark.asyncio
async def test_requires_brightdata_datacenter_credentials(monkeypatch, tmp_path):
    monkeypatch.delenv("BRIGHTDATA_DATACENTER_PASSWORD", raising=False)
    monkeypatch.delenv("BRIGHTDATA_ZONE_PASSWORD", raising=False)
    from scrapers.proxy_config import clear_cache

    clear_cache()
    with pytest.raises(RuntimeError, match="datacenter proxy credentials"):
        amazon_sg.AmazonSGScraper(dry_run=True, output_dir=str(tmp_path))


def test_transform_product_requires_priced_sgd_and_adds_acquisition_metadata(tmp_path):
    scraper = amazon_sg.AmazonSGScraper(dry_run=True, output_dir=str(tmp_path), max_products=10)
    raw = {
        "asin": "B0D1234567",
        "title": "Apple AirPods Pro 2",
        "price": "S$299.00",
        "original_price": "S$329.00",
        "url": "/dp/B0D1234567/ref=sr_1_1",
        "image_url": "https://example.com/img.jpg",
        "rating": "4.6 out of 5 stars",
        "review_count": "1,234",
    }
    try:
        product = scraper.transform_product(raw, "Electronics", "airpods singapore")
        assert product is not None
        assert product["sku"] == "B0D1234567"
        assert product["merchant_id"] == "amazon_sg"
        assert product["currency"] == "SGD"
        assert product["price"] == 299.0
        assert product["url"] == "https://www.amazon.sg/dp/B0D1234567/ref=sr_1_1"
        assert product["metadata"]["acquired"] == "sg-acquire"
        assert product["metadata"]["country_code"] == "SG"
    finally:
        import asyncio

        asyncio.run(scraper.close())


def test_parse_search_results_skips_unpriced_cards(tmp_path):
    html = """
    <div data-component-type="s-search-result" data-asin="B0DPRICED">
      <h2><a href="/dp/B0DPRICED"><span>Samsung Galaxy Buds</span></a></h2>
      <span class="a-price"><span class="a-offscreen">S$149.00</span></span>
      <img class="s-image" src="https://example.com/buds.jpg" />
    </div>
    <div data-component-type="s-search-result" data-asin="B0DNOPRICE">
      <h2><a href="/dp/B0DNOPRICE"><span>Unpriced Listing</span></a></h2>
    </div>
    <a class="s-pagination-next" href="/s?k=test&page=2">Next</a>
    """
    scraper = amazon_sg.AmazonSGScraper(dry_run=True, output_dir=str(tmp_path), max_products=10)
    try:
        products, has_next = scraper.parse_search_results(html, "Electronics", "earbuds")
        assert has_next is True
        assert [product["sku"] for product in products] == ["B0DPRICED"]
    finally:
        import asyncio

        asyncio.run(scraper.close())


def test_block_detector_counts_common_amazon_blocks(tmp_path):
    scraper = amazon_sg.AmazonSGScraper(dry_run=True, output_dir=str(tmp_path), max_products=10)
    try:
        assert scraper._looks_blocked(503, "") is True
        assert scraper._looks_blocked(200, "Enter the characters you see below") is True
        assert scraper._looks_blocked(200, "normal search page") is False
    finally:
        import asyncio

        asyncio.run(scraper.close())
