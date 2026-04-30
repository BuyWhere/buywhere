from scrapers.shein_sg import SHEINScraper, build_scraperapi_proxy_url


def test_extract_categories_from_homepage_filters_fashion_items():
    html = """
    <script>
    {"webClickUrl":"\\/Men-Shirt-Co-ords-c-9037.html","categoryName":"Men Shirt Co-ords"}
    {"webClickUrl":"\\/Women-Dresses-c-1727.html","categoryName":"Women Dresses"}
    {"webClickUrl":"\\/Home-Storage-c-5555.html","categoryName":"Home Storage"}
    </script>
    """

    categories = SHEINScraper.extract_categories_from_homepage(html)

    assert len(categories) == 2
    assert categories[0]["cat_id"] == "9037"
    assert categories[0]["name"] == "Men"
    assert categories[1]["cat_id"] == "1727"
    assert categories[1]["name"] == "Women"


def test_extract_categories_from_homepage_handles_item_picking_nav():
    html = """
    <script>
    {"webClickUrl":"\\/RecommendSelection\\/Men-Clothing-sc-017172963.html"},"categoryNodeType":"categoryTree","categoryName":"Men Clothing","categoryId":"110000035","categoryLanguage":"Men Clothing","cateLeftRealId":"2026"}
    {"webClickUrl":"\\/RecommendSelection\\/Women-Clothing-sc-017172961.html"},"categoryNodeType":"categoryTree","categoryName":"Women Clothing","categoryId":"110000033","categoryLanguage":"Women Clothing","cateLeftRealId":"2030"}
    {"webClickUrl":"\\/RecommendSelection\\/Home-Kitchen-sc-017185546.html"},"categoryNodeType":"categoryTree","categoryName":"Home & Living","categoryId":"110003132","categoryLanguage":"Home & Living","cateLeftRealId":"2032"}
    {"webClickUrl":"\\/RecommendSelection\\/Tools-Home-Improvement-sc-017185547.html"},"categoryNodeType":"categoryTree","categoryName":"Tools & Home Improvement","categoryId":"110003133","categoryLanguage":"Tools & Home Improvement","cateLeftRealId":"4327"}
    {"webClickUrl":"\\/RecommendSelection\\/Cell-Phones-Accessories-sc-017706910.html"},"categoryNodeType":"categoryTree","categoryName":"Cell Phones & Accessories","categoryId":"110005228","categoryLanguage":"Cell Phones & Accessories","cateLeftRealId":"2274"}
    </script>
    """

    categories = SHEINScraper.extract_categories_from_homepage(html)

    assert len(categories) == 2
    assert categories[0]["cat_id"] == "2026"
    assert categories[0]["name"] == "Men"
    assert categories[0]["sub"] == "Clothing"
    assert categories[1]["cat_id"] == "2030"
    assert categories[1]["name"] == "Women"


def test_is_risk_challenge_detects_block_pages():
    blocked = SHEINScraper._is_risk_challenge(
        "https://sg.shein.com/risk/challenge?captcha_type=909",
        "<html>risk-id=abc irregular activities</html>",
    )
    embedded = SHEINScraper._is_risk_challenge(
        "https://sg.shein.com/Men-Shirt-Co-ords-c-9037.html",
        "<html>"
        + ("x" * 6000)
        + 'originalUrl":"/risk/challenge?captcha_type=909&redirection=https%3A%2F%2Fsg.shein.com%2FMen-Shirt-Co-ords-c-9037.html&risk-id=E4799370092505629440"'
        + "</html>",
    )
    clean = SHEINScraper._is_risk_challenge(
        "https://sg.shein.com/sg-en/",
        "<html>Women Dresses</html>",
    )

    assert blocked is True
    assert embedded is True
    assert clean is False


def test_build_scraperapi_proxy_url():
    assert (
        build_scraperapi_proxy_url("abc123")
        == "http://scraperapi:abc123@proxy-server.scraperapi.com:8001"
    )


def test_proxy_headers_added_when_scraperapi_enabled():
    scraper = SHEINScraper(
        api_key="",
        scrape_only=True,
        discover_only=True,
        scraperapi_key="abc123",
    )
    try:
        headers = scraper._headers_with_proxy_options({"User-Agent": "Mozilla/5.0"})
        assert headers["x-sapi-render"] == "true"
        assert headers["x-sapi-country_code"] == "sg"
    finally:
        scraper.cf_scraper.close()
        scraper.request_session.close()


def test_plain_proxy_retry_only_for_non_html_403():
    scraper = SHEINScraper(
        api_key="",
        scrape_only=True,
        discover_only=True,
        scraperapi_key="abc123",
    )
    try:
        assert scraper._should_retry_plain_proxy(403, "Forbidden") is True
        assert scraper._should_retry_plain_proxy(403, "<html>Forbidden</html>") is False
        assert scraper._should_retry_plain_proxy(200, "Forbidden") is False
    finally:
        scraper.cf_scraper.close()
        scraper.request_session.close()


def test_parse_products_from_rendered_html_json_object_fallback():
    html = """
    <div>
      "goods_id":"43870969",
      "goods_name":"OTTIMOZO Set",
      "goods_url_name":"OTTIMOZO-Set",
      "cat_id":"9037",
      "cate_name":"Men Shirt Co-ords",
      "retailPrice":{"amount":"22.99","amountWithSymbol":"S$22.99"},
      "salePrice":{"amount":"19.99","amountWithSymbol":"S$19.99"},
      "comment_num":"1001",
      "comment_rank_average":"4.89",
      "goods_img":"https://img.example/item.jpg"
    </div>
    """

    products = SHEINScraper._parse_products_from_rendered_html(
        html, {"cat_id": "9037", "sub": "Shirt Co-ords"}
    )

    assert len(products) == 1
    assert products[0]["goods_id"] == "43870969"
    assert products[0]["goods_url_name"] == "OTTIMOZO-Set"
    assert products[0]["salePrice"]["amount"] == "19.99"
    assert products[0]["goods_img"] == "https://img.example/item.jpg"


def test_has_product_markers():
    assert SHEINScraper._has_product_markers('foo "goods_url_name":"bar"') is True
    assert SHEINScraper._has_product_markers("<html><body>shell only</body></html>") is False
