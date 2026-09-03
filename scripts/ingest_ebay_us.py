#!/usr/bin/env python3
"""
eBay US data ingestion script with purge + upsert + quality verification
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import text, and_, or_
from sqlalchemy.orm import sessionmaker
import asyncio

# Database configuration
import sys as _sys
from pathlib import Path as _P
_sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import catalog_guard  # fail-fast: bulk writes only ever target maglev
DB_URL = catalog_guard.resolve_catalog_url(driver="asyncpg")

# eBay configuration
MERCHANT_ID = "ebay_us"
SOURCE = "ebay_us"
CURRENCY = "USD"
REGION = "us"
COUNTRY_CODE = "US"

def safe_decimal(val):
    """Safely convert value to Decimal"""
    if val is None or val == "" or val == "None":
        return None
    try:
        d = Decimal(str(val))
        return d if 0 < d < 99999999 else None
    except (InvalidOperation, ValueError, TypeError):
        return None

async def purge_ebay_products(engine):
    """Purge all existing eBay US products from the catalog DB"""
    print("Purging existing eBay US products...")
    
    async with AsyncSession(engine) as session:
        # First, check if ebay.com merchant exists
        result = await session.execute(
            text("SELECT id FROM merchants WHERE domain = 'ebay.com'")
        )
        merchant = result.fetchone()
        
        if not merchant:
            # Create ebay.com merchant record
            print("Creating ebay.com merchant record...")
            await session.execute(
                text("""
                INSERT INTO merchants (domain, name, country, region, active)
                VALUES ('ebay.com', 'eBay US', 'US', 'us', true)
                RETURNING id
                """)
            )
            await session.commit()
            result = await session.execute(
                text("SELECT id FROM merchants WHERE domain = 'ebay.com'")
            )
            merchant = result.fetchone()
        
        merchant_id = merchant[0]
        
        # Purge existing eBay products
        result = await session.execute(
            text("SELECT COUNT(*) FROM products WHERE merchant_id = :merchant_id")
        )
        count = result.fetchone()[0]
        
        await session.execute(
            text("DELETE FROM products WHERE merchant_id = :merchant_id")
        )
        await session.commit()
        
        print(f"Purged {count} eBay US products from catalog")
        return merchant_id

async def upsert_products(engine, merchant_id, products_file):
    """Upsert products from JSONL file into the database"""
    print(f"Ingesting products from {products_file}...")
    
    products_count = 0
    quality_stats = {
        'total': 0,
        'price_gt_zero': 0,
        'has_image': 0,
        'has_brand': 0,
        'price_gt_zero_pct': 0,
        'has_image_pct': 0,
        'has_brand_pct': 0
    }
    
    async with AsyncSession(engine) as session:
        with open(products_file, 'r') as f:
            for line in f:
                try:
                    product_data = json.loads(line.strip())
                    
                    # Skip products with missing required fields
                    if not product_data.get('title') or not product_data.get('price'):
                        continue
                    
                    # Calculate quality metrics
                    price_gt_zero = 1 if product_data.get('price', 0) > 0 else 0
                    has_image = 1 if product_data.get('image_url') else 0
                    has_brand = 1 if product_data.get('brand') else 0
                    
                    quality_stats['total'] += 1
                    quality_stats['price_gt_zero'] += price_gt_zero
                    quality_stats['has_image'] += has_image
                    quality_stats['has_brand'] += has_brand
                    
                    # Prepare product data for database insertion
                    product_dict = {
                        'merchant_id': merchant_id,
                        'source': SOURCE,
                        'title': product_data.get('title', ''),
                        'description': product_data.get('description', ''),
                        'price': safe_decimal(product_data.get('price')),
                        'currency': CURRENCY,
                        'image_url': product_data.get('image_url', ''),
                        'brand': product_data.get('brand', ''),
                        'url': product_data.get('url', ''),
                        'category': product_data.get('category', ''),
                        'region': REGION,
                        'country_code': COUNTRY_CODE,
                        'quality_score': product_data.get('quality_score', 0),
                        'scraped_at': product_data.get('scraped_at', datetime.now(timezone.utc).isoformat()),
                        'created_at': datetime.now(timezone.utc).isoformat(),
                        'updated_at': datetime.now(timezone.utc).isoformat()
                    }
                    
                    # Check if product already exists
                    product_id = product_data.get('id')
                    if product_id:
                        result = await session.execute(
                            text("SELECT id FROM products WHERE source_id = :source_id AND merchant_id = :merchant_id"),
                            {'source_id': product_id, 'merchant_id': merchant_id}
                        )
                        existing = result.fetchone()
                        
                        if existing:
                            # Update existing product
                            product_dict['id'] = existing[0]
                            product_dict.pop('created_at', None)  # Don't update created_at
                            
                            await session.execute(
                                text("""
                                UPDATE products SET
                                    title = :title,
                                    description = :description,
                                    price = :price,
                                    currency = :currency,
                                    image_url = :image_url,
                                    brand = :brand,
                                    url = :url,
                                    category = :category,
                                    region = :region,
                                    country_code = :country_code,
                                    quality_score = :quality_score,
                                    updated_at = :updated_at
                                WHERE id = :id
                                """), product_dict
                            )
                        else:
                            # Insert new product
                            result = await session.execute(
                                text("""
                                INSERT INTO products (
                                    merchant_id, source, source_id, title, description, price, currency,
                                    image_url, brand, url, category, region, country_code,
                                    quality_score, scraped_at, created_at, updated_at
                                ) VALUES (
                                    :merchant_id, :source, :id, :title, :description, :price, :currency,
                                    :image_url, :brand, :url, :category, :region, :country_code,
                                    :quality_score, :scraped_at, :created_at, :updated_at
                                ) RETURNING id
                                """), product_dict
                            )
                            product_dict['id'] = result.fetchone()[0]
                    else:
                        # Insert new product without source_id
                        result = await session.execute(
                            text("""
                            INSERT INTO products (
                                merchant_id, source, title, description, price, currency,
                                image_url, brand, url, category, region, country_code,
                                quality_score, scraped_at, created_at, updated_at
                            ) VALUES (
                                :merchant_id, :source, :title, :description, :price, :currency,
                                :image_url, :brand, :url, :category, :region, :country_code,
                                :quality_score, :scraped_at, :created_at, :updated_at
                            ) RETURNING id
                            """), product_dict
                        )
                        product_dict['id'] = result.fetchone()[0]
                    
                    products_count += 1
                    
                    if products_count % 10 == 0:
                        print(f"  Processed {products_count} products...")
                        
                except Exception as e:
                    print(f"Error processing product: {e}")
                    continue
        
        await session.commit()
        print(f"Successfully ingested {products_count} products into catalog")
    
    # Calculate final quality percentages
    if quality_stats['total'] > 0:
        quality_stats['price_gt_zero_pct'] = (quality_stats['price_gt_zero'] / quality_stats['total']) * 100
        quality_stats['has_image_pct'] = (quality_stats['has_image'] / quality_stats['total']) * 100
        quality_stats['has_brand_pct'] = (quality_stats['has_brand'] / quality_stats['total']) * 100
    
    return products_count, quality_stats

async def verify_quality(quality_stats):
    """Verify quality meets acceptance criteria"""
    print(f"\nQuality Verification:")
    print(f"Total products: {quality_stats['total']}")
    print(f"Price > 0: {quality_stats['price_gt_zero_pct']:.1f}% ({quality_stats['price_gt_zero']}/{quality_stats['total']})")
    print(f"Has image: {quality_stats['has_image_pct']:.1f}% ({quality_stats['has_image']}/{quality_stats['total']})")
    print(f"Has brand: {quality_stats['has_brand_pct']:.1f}% ({quality_stats['has_brand']}/{quality_stats['total']})")
    
    # Check acceptance criteria: 95%+ quality across all metrics
    if (quality_stats['price_gt_zero_pct'] >= 95 and 
        quality_stats['has_image_pct'] >= 95 and 
        quality_stats['has_brand_pct'] >= 95):
        print("✅ Acceptance criteria met: 95%+ quality across all metrics")
        return True
    else:
        print("❌ Acceptance criteria not met")
        print(f"  - Price > 0 requirement: {quality_stats['price_gt_zero_pct']:.1f}% (need 95%+)")
        print(f"  - Has image requirement: {quality_stats['has_image_pct']:.1f}% (need 95%+)")
        print(f"  - Has brand requirement: {quality_stats['has_brand_pct']:.1f}% (need 95%+)")
        return False

async def main():
    parser = argparse.ArgumentParser(description='eBay US Data Ingestion')
    parser.add_argument('--products-file', required=True, help='Path to products JSONL file')
    parser.add_argument('--purge-only', action='store_true', help='Only purge, don\'t ingest')
    parser.add_argument('--verify-only', action='store_true', help='Only verify existing data')
    
    args = parser.parse_args()
    
    print("Starting eBay US data ingestion...")
    
    # Create database engine
    engine = create_async_engine(DB_URL)
    await catalog_guard.assert_catalog_async_engine(engine)
    
    try:
        merchant_id = None
        
        if not args.verify_only:
            # Purge existing products
            merchant_id = await purge_ebay_products(engine)
            
            if args.purge_only:
                print("Purge completed successfully")
                return
        
        # Ingest new products
        if not args.purge_only and os.path.exists(args.products_file):
            products_count, quality_stats = await upsert_products(engine, merchant_id, args.products_file)
            
            if products_count == 0:
                print("No products were ingested")
                return
            
            # Verify quality
            quality_ok = await verify_quality(quality_stats)
            
            if quality_ok:
                print("✅ eBay US re-scrape completed successfully")
                sys.exit(0)
            else:
                print("❌ Quality verification failed")
                sys.exit(1)
        else:
            print("Products file not found")
            sys.exit(1)
            
    except Exception as e:
        print(f"Error during ingestion: {e}")
        sys.exit(1)
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())