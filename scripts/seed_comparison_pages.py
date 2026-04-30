"""
Seed 3 published comparison_pages rows for staging acceptance testing (BUY-2270).

Usage:
    DATABASE_URL=postgresql+asyncpg://... python scripts/seed_comparison_pages.py

Each row picks the first 3 products from the catalog that have price_sgd set.
Run once against staging after migration 808 is applied.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker


SEEDS = [
    {
        "slug": "samsung-galaxy-buds2-pro-best-price-singapore",
        "category": "electronics",
        "expert_summary": "The Samsung Galaxy Buds2 Pro offer excellent ANC and seamless Galaxy integration. Price varies significantly across retailers — compare before buying.",
        "metadata": {
            "faq": [
                {"q": "Are the Galaxy Buds2 Pro worth it?", "a": "Yes — the ANC performance and 360 Audio integration with Samsung devices makes them compelling for Galaxy users."},
                {"q": "Where is the cheapest place to buy in Singapore?", "a": "Prices vary by 10–20% across retailers. Check the comparison above for today's lowest price."},
            ]
        },
    },
    {
        "slug": "apple-airpods-pro-2-best-price-singapore",
        "category": "electronics",
        "expert_summary": "AirPods Pro 2 deliver class-leading ANC and seamless Apple ecosystem integration. Prices are consistent but occasional promotions appear at Challenger and Harvey Norman.",
        "metadata": {
            "faq": [
                {"q": "Do AirPods Pro 2 work with Android?", "a": "Basic playback works, but features like Adaptive Transparency and Personalized Spatial Audio require an iPhone."},
                {"q": "What is the warranty in Singapore?", "a": "Apple provides a 1-year limited warranty in Singapore with optional AppleCare+ extension."},
            ]
        },
    },
    {
        "slug": "dyson-v15-detect-best-price-singapore",
        "category": "home-appliances",
        "expert_summary": "The Dyson V15 Detect is Dyson's flagship cordless vacuum with laser dust detection. Stock availability and bundles vary — comparing retailers often saves S$80–150.",
        "metadata": {
            "faq": [
                {"q": "Is the Dyson V15 worth the price in Singapore?", "a": "For pet owners or allergy sufferers, yes. The particle counting and laser detection genuinely improve cleaning effectiveness."},
                {"q": "What accessories are included?", "a": "Bundles differ by retailer. Some include the hair screw tool; others include extra battery. Check the retailer page before purchasing."},
            ]
        },
    },
]


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Fetch up to 9 products with price_sgd set (3 per comparison page)
        result = await session.execute(
            text("""
                SELECT id FROM products
                WHERE price_sgd IS NOT NULL AND url IS NOT NULL AND is_active = TRUE
                ORDER BY id ASC
                LIMIT 9
            """)
        )
        product_ids = [row[0] for row in result.fetchall()]

        if len(product_ids) < 3:
            print(f"WARNING: only {len(product_ids)} eligible products found; seeding with available IDs")

        now = datetime.now(timezone.utc)

        for i, seed in enumerate(SEEDS):
            chunk = product_ids[i * 3: i * 3 + 3]
            if not chunk:
                print(f"SKIP {seed['slug']}: no product IDs available for slot {i}")
                continue

            await session.execute(
                text("""
                    INSERT INTO comparison_pages
                        (slug, category, status, product_ids, expert_summary, metadata, published_at, created_at, updated_at)
                    VALUES
                        (:slug, :category, 'published', :product_ids, :expert_summary, :metadata::jsonb, :now, :now, :now)
                    ON CONFLICT (slug) DO UPDATE SET
                        status = 'published',
                        product_ids = EXCLUDED.product_ids,
                        expert_summary = EXCLUDED.expert_summary,
                        metadata = EXCLUDED.metadata,
                        published_at = EXCLUDED.published_at,
                        updated_at = EXCLUDED.updated_at
                """),
                {
                    "slug": seed["slug"],
                    "category": seed["category"],
                    "product_ids": "{" + ",".join(str(pid) for pid in chunk) + "}",
                    "expert_summary": seed["expert_summary"],
                    "metadata": __import__("json").dumps(seed["metadata"]),
                    "now": now,
                },
            )
            print(f"  seeded: {seed['slug']} → product_ids={chunk}")

        await session.commit()
        print("Done. Run: GET /v1/compare/pages/<slug> to verify.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
