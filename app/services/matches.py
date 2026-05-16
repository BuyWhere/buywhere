import re
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.compare import (
    compute_string_similarity,
    normalize_brand,
    normalize_text,
    normalized_title_key,
)
from app.logging_centralized import get_logger
from app.models.product import Product, ProductMatch

logger = get_logger("matches-service")

US_RETAILER_SOURCE_GROUPS = {
    "amazon": ("amazon_us", "amazon.com"),
    "walmart": ("walmart_us", "walmart.com"),
    "target": ("target_us", "target.com"),
}
US_RETAILER_PREFIXES = tuple(
    prefix for prefixes in US_RETAILER_SOURCE_GROUPS.values() for prefix in prefixes
)
STOP_WORDS = {
    "and",
    "for",
    "from",
    "new",
    "pack",
    "set",
    "that",
    "the",
    "this",
    "with",
}


def is_us_retailer_source(source: Optional[str]) -> bool:
    if not source:
        return False
    source = source.lower()
    return any(source == prefix or source.startswith(f"{prefix}_") for prefix in US_RETAILER_PREFIXES)


def retailer_key(source: Optional[str]) -> Optional[str]:
    if not source:
        return None
    source = source.lower()
    for key, prefixes in US_RETAILER_SOURCE_GROUPS.items():
        if any(source == prefix or source.startswith(f"{prefix}_") for prefix in prefixes):
            return key
    return None


def normalized_match_key(title: Optional[str], brand: Optional[str]) -> str:
    """Stable Python-side key for same-product name+brand matching."""
    return normalized_title_key(title or "", brand or "")


def title_search_tokens(title: Optional[str], limit: int = 6) -> List[str]:
    words = re.findall(r"\b[a-z0-9]{3,}\b", normalize_text(title))
    tokens: List[str] = []
    for word in words:
        if word in STOP_WORDS or word in tokens:
            continue
        tokens.append(word)
        if len(tokens) >= limit:
            break
    return tokens


def score_name_brand_match(source_product: Product, candidate: Product) -> float:
    source_key = normalized_match_key(source_product.title, source_product.brand)
    candidate_key = normalized_match_key(candidate.title, candidate.brand)
    name_score = compute_string_similarity(source_key, candidate_key)

    source_brand = normalize_brand(source_product.brand)
    candidate_brand = normalize_brand(candidate.brand)
    brand_score = 1.0 if source_brand and source_brand == candidate_brand else 0.0

    price_score = 0.0
    if source_product.price and candidate.price and float(source_product.price) > 0:
        price_diff_pct = abs(float(source_product.price) - float(candidate.price)) / float(source_product.price)
        price_score = max(0.0, 1.0 - min(price_diff_pct, 1.0))

    # Brand/name dominate because this is same-item matching, not alternatives.
    return round((name_score * 0.72) + (brand_score * 0.20) + (price_score * 0.08), 4)


class MatchService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_stored_matches(
        self,
        product_id: int,
        min_confidence: float = 0.0,
        limit: int = 50,
    ) -> List[ProductMatch]:
        query = (
            select(ProductMatch)
            .where(
                and_(
                    or_(
                        ProductMatch.source_product_id == product_id,
                        ProductMatch.matched_product_id == product_id,
                    ),
                    ProductMatch.confidence_score >= min_confidence,
                )
            )
            .order_by(ProductMatch.confidence_score.desc())
            .limit(limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def compute_and_store_matches(
        self,
        product_id: int,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
    ) -> List[Tuple[Product, float]]:
        result = await self.db.execute(
            select(Product).where(and_(Product.id == product_id, Product.is_active == True))
        )
        source_product = result.scalar_one_or_none()
        if not source_product:
            return []

        matches = await self.find_us_name_brand_matches(source_product, min_price, max_price)

        for matched_product, score in matches:
            await self._store_match(source_product, matched_product, score)
            await self._store_match(matched_product, source_product, score)

        await self.db.commit()
        return matches

    async def find_us_name_brand_matches(
        self,
        source_product: Product,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
    ) -> List[Tuple[Product, float]]:
        if not is_us_retailer_source(source_product.source):
            return []

        source_brand = normalize_brand(source_product.brand)
        tokens = title_search_tokens(source_product.title)
        if not source_brand or not tokens:
            return []

        source_retailer = retailer_key(source_product.source)
        if not source_retailer:
            return []

        same_retailer_conditions = [
            Product.source.like(f"{prefix}%")
            for prefix in US_RETAILER_SOURCE_GROUPS[source_retailer]
        ]
        us_retailer_conditions = [
            Product.source.like(f"{prefix}%")
            for prefix in US_RETAILER_PREFIXES
        ]

        query = (
            select(Product)
            .where(Product.is_active == True)
            .where(Product.id != source_product.id)
            .where(Product.currency == "USD")
            .where(~or_(*same_retailer_conditions))
            .where(or_(*us_retailer_conditions))
            .where(Product.brand.ilike(source_product.brand))
        )

        for token in tokens[:4]:
            query = query.where(Product.title.ilike(f"%{token}%"))

        if min_price is not None:
            query = query.where(Product.price >= min_price)
        if max_price is not None:
            query = query.where(Product.price <= max_price)

        result = await self.db.execute(query.limit(500))
        candidates = result.scalars().all()
        matches: List[Tuple[Product, float]] = []

        for candidate in candidates:
            if normalize_brand(candidate.brand) != source_brand:
                continue
            score = score_name_brand_match(source_product, candidate)
            if score >= 0.84:
                matches.append((candidate, score))

        matches.sort(key=lambda row: row[1], reverse=True)
        return matches[:100]

    async def _store_match(
        self,
        source_product: Product,
        matched_product: Product,
        combined_score: float,
    ) -> None:
        source_name = normalized_title_key(source_product.title, source_product.brand)
        matched_name = normalized_title_key(matched_product.title, matched_product.brand)
        name_sim = compute_string_similarity(source_name, matched_name)

        if source_product.price and matched_product.price and float(source_product.price) > 0:
            price_diff = abs(float(source_product.price) - float(matched_product.price)) / float(source_product.price)
        else:
            price_diff = None

        values = {
            "source_product_id": source_product.id,
            "matched_product_id": matched_product.id,
            "confidence_score": Decimal(str(round(combined_score, 4))),
            "match_method": "us_name_brand",
            "name_similarity": Decimal(str(round(name_sim, 4))) if name_sim else None,
            "image_similarity": None,
            "price_diff_pct": Decimal(str(round(price_diff, 4))) if price_diff else None,
            "source": source_product.source,
        }

        stmt = insert(ProductMatch).values(**values)
        stmt = stmt.on_conflict_do_update(
            constraint="product_matches_unique",
            set_={
                "confidence_score": stmt.excluded.confidence_score,
                "match_method": stmt.excluded.match_method,
                "name_similarity": stmt.excluded.name_similarity,
                "image_similarity": stmt.excluded.image_similarity,
                "price_diff_pct": stmt.excluded.price_diff_pct,
            },
        )
        await self.db.execute(stmt)

    async def get_or_compute_matches(
        self,
        product_id: int,
        min_confidence: float = 0.0,
        limit: int = 50,
        recompute: bool = False,
    ) -> List[ProductMatch]:
        if recompute:
            await self.compute_and_store_matches(product_id)

        stored = await self.get_stored_matches(product_id, min_confidence, limit)
        if stored:
            return stored

        await self.compute_and_store_matches(product_id)
        return await self.get_stored_matches(product_id, min_confidence, limit)
