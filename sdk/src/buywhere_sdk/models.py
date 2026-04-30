from __future__ annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class Product(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    price_sgd: Optional[Decimal] = None
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = None
    region: str = "sg"
    country_code: str = "SG"
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    price_trend: Optional[str] = None
    confidence_score: Optional[float] = None
    specs: Optional[Dict[str, Any]] = None
    metadata: Optional[Any] = None


class ProductList(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[Product]
    has_more: bool = False
    next_cursor: Optional[int] = None


class DealItem(BaseModel):
    id: int
    name: str
    source: str
    price: Decimal
    original_price: Decimal
    currency: str
    discount_pct: float
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    expires_at: Optional[datetime] = None


class DealList(BaseModel):
    total: int
    items: List[DealItem]
    has_more: bool = False


class CategoryNode(BaseModel):
    id: str
    name: str
    slug: str
    product_count: int
    subcategories: List[Dict[str, Any]] = Field(default_factory=list)


class CategoryList(BaseModel):
    total: int
    categories: List[CategoryNode]


class ApiInfo(BaseModel):
    api: str = "BuyWhere Catalog API"
    version: str = "v1"
    endpoints: Dict[str, str] = Field(default_factory=dict)
    auth: str = "Bearer token required (API key)"
    docs: str = "/docs"


class HealthStatus(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    environment: str = "production"