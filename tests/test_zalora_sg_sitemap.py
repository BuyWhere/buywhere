import json
import sys
from pathlib import Path

sys.path.insert(0, "/home/paperclip/buywhere-api")

from scrapers.zalora_sg_sitemap import (
    SitemapEntry,
    ZaloraSitemapScraper,
    interleave_entries_by_shard,
    summarize_ndjson_file,
)


def test_load_existing_product_ids_supports_current_baseline_shape(tmp_path):
    baseline = tmp_path / "zalora_sg_20260416.ndjson"
    baseline.write_text(
        "\n".join(
            [
                json.dumps({"product_id": "zalora_sg_459942"}),
                json.dumps({"sku": "zalora_sg_123456"}),
                json.dumps({"metadata": {"product_id": "zalora_sg_777"}}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    scraper = ZaloraSitemapScraper(
        output_file=str(tmp_path / "fresh.ndjson"),
        coverage_report=str(tmp_path / "coverage.json"),
        resume_from=[str(baseline)],
    )

    loaded = scraper.load_existing_product_ids()

    assert loaded == 3
    assert scraper.existing_product_ids == {"459942", "123456", "777"}


def test_parse_product_page_extracts_priced_product_from_next_data(tmp_path):
    scraper = ZaloraSitemapScraper(
        output_file=str(tmp_path / "fresh.ndjson"),
        coverage_report=str(tmp_path / "coverage.json"),
    )
    entry = SitemapEntry(
        shard="product-sitemap-1.xml",
        slug="birkenstock-milano-bf-black-459942",
        image_url="https://static-sg.zacdn.com/p/birkenstock-7959-249954-1.jpg",
    )
    html = """
    <html>
      <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "preloadedState": {
              "pdv": {
                "product": {
                  "Name": "Milano BF",
                  "Brand": "Birkenstock",
                  "Price": "169.00",
                  "Url": "https://www.zalora.sg/p/birkenstock-milano-bf-black-459942",
                  "Attributes": {
                    "heel_height": "flat"
                  },
                  "Simples": [
                    {
                      "Price": "169.00",
                      "StockStatus": 1,
                      "FulfillmentInformation": {
                        "SellerName": "ZALORA"
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
      </script>
    </html>
    """

    product = scraper._parse_product_page(html, entry)

    assert product is not None
    assert product["product_id"] == "zalora_sg_459942"
    assert product["name"] == "Milano BF"
    assert product["price"]["amount"] == 169.0
    assert product["category"] == "Shoes"
    assert product["merchant_id"] == "zalora"
    assert product["image_url"] == entry.image_url


def test_interleave_entries_by_shard_spreads_early_queue_across_sitemaps():
    entries = [
        SitemapEntry(shard="product-sitemap-1.xml", slug="item-a-1", image_url=""),
        SitemapEntry(shard="product-sitemap-1.xml", slug="item-a-2", image_url=""),
        SitemapEntry(shard="product-sitemap-2.xml", slug="item-b-1", image_url=""),
        SitemapEntry(shard="product-sitemap-3.xml", slug="item-c-1", image_url=""),
        SitemapEntry(shard="product-sitemap-4.xml", slug="item-d-1", image_url=""),
    ]

    interleaved = interleave_entries_by_shard(entries)

    assert [entry.shard for entry in interleaved[:4]] == [
        "product-sitemap-1.xml",
        "product-sitemap-2.xml",
        "product-sitemap-3.xml",
        "product-sitemap-4.xml",
    ]
    assert interleaved[4].slug == "item-a-2"


def test_record_failure_sample_caps_unique_urls_per_status(tmp_path):
    scraper = ZaloraSitemapScraper(
        output_file=str(tmp_path / "fresh.ndjson"),
        coverage_report=str(tmp_path / "coverage.json"),
    )
    entry = SitemapEntry(
        shard="product-sitemap-2.xml",
        slug="blocked-item-100",
        image_url="",
    )

    for suffix in range(7):
        varied = SitemapEntry(
            shard=entry.shard,
            slug=f"blocked-item-{suffix}",
            image_url="",
        )
        scraper._record_failure_sample(varied, "direct_status_403", f"https://www.zalora.sg/product/blocked-item-{suffix}")

    scraper._record_failure_sample(entry, "direct_status_403", "https://www.zalora.sg/product/blocked-item-0")

    samples = scraper.shard_failure_samples[entry.shard]["direct_status_403"]
    assert len(samples) == 5
    assert samples[0] == "https://www.zalora.sg/product/blocked-item-0"
    assert samples[-1] == "https://www.zalora.sg/product/blocked-item-4"


def test_summarize_ndjson_file_reports_line_count_and_size(tmp_path):
    path = tmp_path / "sample.ndjson"
    path.write_text('{"a":1}\n\n{"b":2}\n', encoding="utf-8")

    summary = summarize_ndjson_file(path)

    assert summary["exists"] is True
    assert summary["line_count"] == 2
    assert summary["size_bytes"] == path.stat().st_size


def test_seed_output_from_resume_source_copies_missing_canonical_file(tmp_path):
    resume = tmp_path / "resume.ndjson"
    resume.write_text('{"product_id":"zalora_sg_1"}\n', encoding="utf-8")
    output = tmp_path / "canonical.ndjson"

    scraper = ZaloraSitemapScraper(
        output_file=str(output),
        coverage_report=str(tmp_path / "coverage.json"),
        resume_from=[str(resume)],
    )

    seeded_from = scraper.seed_output_from_resume_source()

    assert seeded_from == resume
    assert output.read_text(encoding="utf-8") == resume.read_text(encoding="utf-8")
