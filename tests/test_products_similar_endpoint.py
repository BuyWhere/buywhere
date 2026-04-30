import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.models.product import Product
from app.schemas.product import SimilarProductsResponse


class TestSimilarProductsEndpoint:
    def test_similar_product_not_found(self, mock_db, mock_api_key, mock_request, mock_cache):
        async def run_test():
            from app.routers.products import get_similar_products

            mock_cache["get"].return_value = None
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            mock_db.execute.return_value = mock_result

            with pytest.raises(HTTPException) as exc_info:
                await get_similar_products(
                    request=mock_request,
                    product_id=999,
                    limit=10,
                    db=mock_db,
                    api_key=mock_api_key,
                )

            assert exc_info.value.status_code == 404

        asyncio.run(run_test())

    def test_similar_query_uses_category_price_band_and_different_merchant(
        self, mock_db, mock_api_key, mock_request, sample_product, mock_cache
    ):
        async def run_test():
            from app.routers.products import get_similar_products

            mock_cache["get"].return_value = None

            mock_source_result = MagicMock()
            mock_source_result.scalar_one_or_none.return_value = sample_product

            mock_candidates_result = MagicMock()
            mock_candidates_result.scalars.return_value.all.return_value = []

            mock_db.execute.side_effect = [mock_source_result, mock_candidates_result]

            result = await get_similar_products(
                request=mock_request,
                product_id=sample_product.id,
                limit=10,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert isinstance(result, SimilarProductsResponse)

            executed_query = mock_db.execute.await_args_list[1].args[0]
            compiled_query = str(
                executed_query.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True},
                )
            )
            assert "products.category = 'Electronics'" in compiled_query
            assert "products.merchant_id != 'merchant_001'" in compiled_query
            assert "1399.30" in compiled_query
            assert "2598.70" in compiled_query

        asyncio.run(run_test())

    def test_similar_returns_full_product_objects(self, mock_db, mock_api_key, mock_request, sample_product, mock_cache):
        async def run_test():
            from app.routers.products import get_similar_products

            mock_cache["get"].return_value = None

            candidate = MagicMock(spec=Product)
            candidate.id = 2
            candidate.sku = "SKU-002"
            candidate.source = "lazada_sg"
            candidate.merchant_id = "merchant_002"
            candidate.title = "iPhone 14 Pro Max 256GB"
            candidate.description = "Alternative listing"
            candidate.price = Decimal("1899.00")
            candidate.currency = "SGD"
            candidate.price_sgd = Decimal("1899.00")
            candidate.price_usd = None
            candidate.url = "https://lazada.sg/product/456"
            candidate.brand = "Apple"
            candidate.category = "Electronics"
            candidate.category_path = ["Electronics", "Phones"]
            candidate.image_url = "https://lazada.sg/image.jpg"
            candidate.barcode = None
            candidate.is_available = True
            candidate.in_stock = True
            candidate.stock_level = None
            candidate.last_checked = datetime(2024, 1, 16, tzinfo=timezone.utc)
            candidate.data_updated_at = datetime(2024, 1, 16, tzinfo=timezone.utc)
            candidate.rating = Decimal("4.4")
            candidate.review_count = 87
            candidate.avg_rating = Decimal("4.4")
            candidate.rating_source = "lazada"
            candidate.metadata_ = {"condition": "new"}
            candidate.updated_at = datetime(2024, 1, 16, tzinfo=timezone.utc)

            mock_source_result = MagicMock()
            mock_source_result.scalar_one_or_none.return_value = sample_product

            mock_candidates_result = MagicMock()
            mock_candidates_result.scalars.return_value.all.return_value = [candidate]

            mock_db.execute.side_effect = [mock_source_result, mock_candidates_result]

            result = await get_similar_products(
                request=mock_request,
                product_id=sample_product.id,
                limit=10,
                db=mock_db,
                api_key=mock_api_key,
            )

            assert result.total == 1
            assert result.items[0].id == 2
            assert result.items[0].merchant_id == "merchant_002"
            assert result.items[0].name == "iPhone 14 Pro Max 256GB"
            assert result.items[0].buy_url == "https://lazada.sg/product/456"

        asyncio.run(run_test())
