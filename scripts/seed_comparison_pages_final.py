"""
Seed final 4 comparison pages + archive 3 dev seed pages for BUY-4902.

Usage:
    export BUYWHERE_DATABASE_URL=postgresql+asyncpg://buywhere:buywhere@db:5432/catalog
    python scripts/seed_comparison_pages_final.py

This script:
1. Archives 3 existing dev seed pages by setting status='archived'
2. Seeds 4 final published comparison pages (or flags if content missing)

The 4 final pages:
  - nintendo-switch-2     (electronics)
  - dyson-v12-detect-slim  (home)
  - xiaomi-robot-vacuum-s10-plus  (home)
  - blackmores-fish-oil-1000mg-400cap  (health)

Run after migration 808 is applied (comparison_pages table exists).
"""
import asyncio
import os
import sys
import json
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker


DEV_SEED_SLUGS = [
    "tplink-tapo-c100-home-security-wifi-camera",
    "gopro-hero13-black-creator-edition",
    "dji-osmo-pocket-3",
]

FINAL_PAGES = [
    {
        "slug": "nintendo-switch-2",
        "category": "electronics",
        "brand_search": "Nintendo",
        "title_contains": "Switch 2",
        "expert_summary": (
            "The Nintendo Switch 2 is Nintendo's next-generation console with enhanced performance, "
            "larger display, and improved Joy-Con controllers. Price varies across Singapore retailers — "
            "compare bundled editions and individual console pricing before purchasing."
        ),
        "metadata": {
            "faq": [
                {
                    "q": "What edition should I buy in Singapore?",
                    "a": "Prices and bundle contents vary by retailer. The standard edition starts at S$469, "
                        "but bundled editions (with extra game or accessories) often offer better value."
                },
                {
                    "q": "Is the Switch 2 backwards compatible?",
                    "a": "Yes — Switch 2 is fully backwards compatible with all Switch and Switch OLED titles."
                },
            ]
        },
    },
    {
        "slug": "dyson-v12-detect-slim",
        "category": "home",
        "brand_search": "Dyson",
        "title_contains": "V12",
        "expert_summary": (
            "The Dyson V12 Detect Slim is a premium cordless vacuum with laser dust detection and "
            "intelligent suction adaptation. Stock availability and bundle contents vary by retailer — "
            "compare pricing and included accessories before purchasing."
        ),
        "metadata": {
            "faq": [
                {
                    "q": "Is the V12 Detect worth the price in Singapore?",
                    "a": "For homes with pets or allergy sufferers, the laser detection and HEPA filtration "
                        "justify the premium. For light cleaning needs, a more affordable model may suffice."
                },
                {
                    "q": "What accessories are included?",
                    "a": "Bundles differ by retailer. Some include the wand and crevice tool; others include "
                        "the hair screw tool. Check what's included before purchasing."
                },
            ]
        },
    },
    {
        "slug": "xiaomi-robot-vacuum-s10-plus",
        "category": "home",
        "brand_search": "Xiaomi",
        "title_contains": "Robot Vacuum S10",
        "expert_summary": (
            "The Xiaomi Robot Vacuum S10+ offers strong mopping and vacuuming performance at a competitive "
            "price point. Different retailers offer different bundled accessories — compare before buying."
        ),
        "metadata": {
            "faq": [
                {
                    "q": "How does it compare to the Dyson V15?",
                    "a": "The Xiaomi offers lidar navigation and mopping at ~S$700 vs Dyson's ~S$1,200. "
                        "The Dyson has stronger suction and a premium build, but the Xiaomi delivers "
                        "excellent value for daily maintenance cleaning."
                },
                {
                    "q": "Does it work on thick carpets?",
                    "a": "The S10+ can handle low-to-medium pile carpets but may struggle with high-pile rugs. "
                        "The auto-empty station (included in some bundles) helps with maintenance."
                },
            ]
        },
    },
    {
        "slug": "blackmores-fish-oil-1000mg-400cap",
        "category": "health",
        "brand_search": "Blackmores",
        "title_contains": "Fish Oil",
        "expert_summary": None,
        "metadata": {
            "faq": [
                {
                    "q": "Is Blackmores Fish Oil 1000mg worth it?",
                    "a": "Blackmores is a trusted Australian brand with third-party tested fish oil. "
                        "The 1000mg dose is standard for daily omega-3 supplementation. "
                        "Price comparison is worthwhile as retailers frequently run promotions."
                },
                {
                    "q": "Where can I buy authentic Blackmores products in Singapore?",
                    "a": "Buy from official distributors (Watsons, Guardian, or the Blackmores website) "
                        "to ensure product authenticity. Avoid third-party marketplaces if price seems too low."
                },
            ]
        },
        "flag_missing": True,
    },
]


async def _lookup_product_ids(db: AsyncSession, brand: str, title_contains: str, min_count: int = 3) -> tuple[list[int], bool]:
    result = await db.execute(
        text("""
            SELECT id, title, source, price_sgd
            FROM products
            WHERE is_active = TRUE
              AND url IS NOT NULL
              AND (brand ILIKE :brand OR title ILIKE :brand)
              AND title ILIKE :title
            ORDER BY price_sgd ASC NULLS LAST
            LIMIT :limit
        """),
        {
            "brand": f"%{brand}%",
            "title": f"%{title_contains}%",
            "limit": min_count + 5,
        }
    )
    rows = result.fetchall()
    if not rows:
        return [], False
    product_ids = [r[0] for r in rows]
    titles = [r[1] for r in rows]
    found_count = len(product_ids)
    return product_ids, found_count >= min_count


async def main() -> None:
    db_url = os.environ.get("BUYWHERE_DATABASE_URL")
    if not db_url:
        db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: BUYWHERE_DATABASE_URL or DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        now = datetime.now(timezone.utc)
        results = {}

        # Step 1: Archive dev seed pages
        print("\n=== Archiving dev seed pages ===")
        for slug in DEV_SEED_SLUGS:
            res = await session.execute(
                text("""
                    UPDATE comparison_pages
                    SET status = 'archived', updated_at = :now
                    WHERE slug = :slug AND status != 'archived'
                    RETURNING id, slug
                """),
                {"slug": slug, "now": now}
            )
            row = res.fetchone()
            if row:
                print(f"  archived: {slug} (id={row[0]})")
            else:
                print(f"  not found or already archived: {slug}")

        # Step 2: Seed final 4 pages
        print("\n=== Seeding final 4 comparison pages ===")
        for page_def in FINAL_PAGES:
            slug = page_def["slug"]
            brand = page_def["brand_search"]
            title_contains = page_def["title_contains"]

            # Look up product IDs
            product_ids, enough_found = await _lookup_product_ids(
                session, brand, title_contains, min_count=3
            )

            if not product_ids:
                print(f"\n  WARNING: No products found for {slug} ({brand}, contains '{title_contains}')")
                print(f"  This page will be created with empty product_ids — flag for Lyra to populate content")
                results[slug] = {"status": "no_products", "product_ids": [], "flag_missing": page_def.get("flag_missing", False)}
                continue

            has_enough = len(product_ids) >= 3
            print(f"\n  {slug}: found {len(product_ids)} products (need ≥3: {has_enough})")
            for pid in product_ids[:5]:
                print(f"    - product_id={pid}")

            expert_summary = page_def["expert_summary"]
            flag_missing = False

            if page_def.get("flag_missing") and not expert_summary:
                # Blackmores content not in system - flag for Lyra
                expert_summary = "[PENDING] Blackmores content not yet in system — Lyra to provide expert summary + product IDs (BUY-2271)"
                flag_missing = True

            metadata_json = json.dumps(page_def["metadata"])

            res = await session.execute(
                text("""
                    INSERT INTO comparison_pages
                        (slug, category, status, product_ids, expert_summary, metadata, published_at, created_at, updated_at)
                    VALUES
                        (:slug, :category, 'published', :product_ids, :expert_summary, :metadata, :now, :now, :now)
                    ON CONFLICT (slug) DO UPDATE SET
                        status = 'published',
                        product_ids = EXCLUDED.product_ids,
                        expert_summary = EXCLUDED.expert_summary,
                        metadata = EXCLUDED.metadata,
                        published_at = EXCLUDED.published_at,
                        updated_at = EXCLUDED.updated_at
                    RETURNING id, slug, status
                """),
                {
                    "slug": slug,
                    "category": page_def["category"],
                    "product_ids": product_ids,
                    "expert_summary": expert_summary,
                    "metadata": metadata_json,
                    "now": now,
                }
            )
            row = res.fetchone()
            print(f"  seeded/updated: {slug} (id={row[0]}, status={row[2]})")
            if flag_missing:
                print(f"  FLAG: content not in system — Lyra needs to provide expert summary + verify products")
            results[slug] = {
                "status": "seeded" if has_enough else "partial",
                "product_ids": product_ids[:3],
                "all_found": has_enough,
                "flag_missing": flag_missing,
            }

        await session.commit()

        # Summary
        print("\n=== Summary ===")
        for slug, info in results.items():
            status_icon = "⚠️" if not info.get("all_found") else ("🚨" if info.get("flag_missing") else "✅")
            print(f"  {status_icon} {slug}: {info['status']} | {len(info.get('product_ids', []))} products")
            if info.get("flag_missing"):
                print(f"      -> Lyra needs to provide Blackmores content + verify product IDs")

        print("\nDone. Verify with: GET /v1/compare/pages/<slug>")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())