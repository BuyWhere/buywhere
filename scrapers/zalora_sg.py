"""
Compatibility entrypoint for the Zalora SG catalog scraper.

The scheduled module path stays `scrapers.zalora_sg`, but the execution path now
uses the sitemap crawler so Zalora runs from the daily resume-capable catalog
baseline instead of the older category-listing scraper.
"""

from scrapers.zalora_sg_sitemap import ZaloraSitemapScraper, main

ZaloraScraper = ZaloraSitemapScraper


if __name__ == "__main__":
    raise SystemExit(main())
