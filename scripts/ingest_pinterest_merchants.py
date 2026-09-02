#!/usr/bin/env python3
"""Ingest Pinterest validated merchants into BuyWhere merchants table.

Reads pinterest_merchants.ndjson and upserts into PostgreSQL.
Fixed for actual production schema (id, name, source, country, onboarding_stage, created_at).
"""
import asyncio
import json
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import catalog_guard  # fail-fast: bulk writes only ever target maglev
DB_URL = catalog_guard.resolve_catalog_url(driver="asyncpg")

MERCHANTS_NDJSON = Path("/home/paperclip/buywhere-api/data/social_commerce/pinterest_merchants.ndjson")


async def ingest_merchants():
    if not MERCHANTS_NDJSON.exists():
        print(f"ERROR: {MERCHANTS_NDJSON} not found")
        return

    merchants = []
    with open(MERCHANTS_NDJSON) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    merchants.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    print(f"Loaded {len(merchants)} merchants from NDJSON")

    if not merchants:
        print("No merchants to ingest")
        return

    engine = create_async_engine(DB_URL, echo=False)
    await catalog_guard.assert_catalog_async_engine(engine)

    # Production schema only has: id, name, source, country, onboarding_stage, created_at
    upsert_sql = text("""
        INSERT INTO merchants (id, name, source, country, onboarding_stage)
        VALUES (:id, :name, :source, :country, :onboarding_stage)
        ON CONFLICT (id) DO UPDATE SET
            name             = EXCLUDED.name,
            source           = EXCLUDED.source,
            country          = EXCLUDED.country,
            onboarding_stage = EXCLUDED.onboarding_stage
        RETURNING id, name, onboarding_stage
    """)

    inserted = 0
    updated = 0
    failed = 0

    for m in merchants:
        domain = m.get("domain", "")
        slug = domain.replace(".", "").replace("-", "").replace("_", "")
        merchant_id = f"social_pinterest_{slug}"

        name = domain
        source = m.get("source_attribution", "social_pinterest")
        country = m.get("country", "US")
        platform = m.get("platform", "unknown")

        params = {
            "id": merchant_id,
            "name": name,
            "source": source,
            "country": country,
            "onboarding_stage": "interested",
        }

        # Each merchant in its own transaction for resilience
        async with engine.begin() as conn:
            try:
                result = await conn.execute(upsert_sql, params)
                row = result.fetchone()
                stage = row[2] if row else "?"
                action = "NEW" if stage == "interested" else "UPD"
                if stage == "interested":
                    inserted += 1
                else:
                    updated += 1
                print(f"  {action} {domain:40s} -> {merchant_id} [{platform}]")
            except Exception as e:
                err_msg = str(e)[:120]
                print(f"  FAIL {domain}: {err_msg}")
                failed += 1

    await engine.dispose()

    print(f"\n{'='*50}")
    print(f"PINTEREST MERCHANT INGESTION COMPLETE")
    print(f"{'='*50}")
    print(f"Total merchants:      {len(merchants)}")
    print(f"Inserted (new):       {inserted}")
    print(f"Updated (existing):   {updated}")
    print(f"Failed:              {failed}")
    print(f"{'='*50}")

    # Also save a summary of what was ingested
    summary = {
        "pipeline": "pinterest_ingestion",
        "issue": "BUY-18009",
        "ingested_at": __import__("datetime").datetime.now().isoformat(),
        "total": len(merchants),
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
    }
    summary_path = Path("/home/paperclip/buywhere-api/data/social_commerce/pinterest_ingestion_result.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Summary saved to {summary_path}")


if __name__ == "__main__":
    asyncio.run(ingest_merchants())
