"""Seed demo data for local dev/staging validation."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.config import get_settings
from app.auth import provision_api_key
from app.models.product import Merchant, Product

settings = get_settings()


async def seed():
    engine = create_async_engine(settings.database_url, echo=True)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        # Seed a merchant
        merchant = Merchant(id="lazada_sg_demo", name="Lazada SG Demo", source="lazada_sg", country="SG")
        db.add(merchant)

        # Seed 5 demo products
        products = [
            Product(sku=f"DEMO-{i:04d}", source="lazada_sg", merchant_id="lazada_sg_demo",
                    title=f"Demo Product {i}", description=f"Description for demo product {i}",
                    price=10.00 + i * 5, currency="SGD",
                    url=f"https://www.lazada.sg/products/demo-{i}.html",
                    category="Electronics", category_path=["Electronics", "Gadgets"],
                    image_url=f"https://img.lazada.sg/demo-{i}.jpg",
                    is_active=True)
            for i in range(1, 6)
        ]
        for p in products:
            db.add(p)

        # Provision a demo API key
        raw_key, api_key = await provision_api_key(
            developer_id="demo-developer",
            name="Demo Key",
            tier="basic",
            db=db,
        )

        await db.commit()
        print(f"\n✅ Seeded {len(products)} products and 1 merchant.")
        print(f"🔑 Demo API key: {raw_key}")
        print(f"   (Key ID: {api_key.id})\n")
        print("Test it:")
        print(f'  curl -H "Authorization: Bearer {raw_key}" http://localhost:8000/v1/products')

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
