"""Ingest API schemas."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class IngestErrorCode(str, Enum):
    VALIDATION_PRICE_NON_POSITIVE = "validation_price_non_positive"
    VALIDATION_PRICE_OUT_OF_RANGE = "validation_price_out_of_range"
    VALIDATION_URL_INVALID = "validation_url_invalid"
    VALIDATION_IMAGE_URL_INVALID = "validation_image_url_invalid"
    VALIDATION_CURRENCY_INVALID = "validation_currency_invalid"
    VALIDATION_TITLE_REQUIRED = "validation_title_required"
    VALIDATION_SKU_REQUIRED = "validation_sku_required"
    VALIDATION_MERCHANT_ID_REQUIRED = "validation_merchant_id_required"
    VALIDATION_ACTIVE_STOCK_CONFLICT = "validation_active_stock_conflict"
    DATABASE_ERROR = "database_error"
    QUALITY_CRITICAL_FAIL = "quality_critical_fail"
    UNKNOWN_ERROR = "unknown_error"
    # Legacy aliases
    VALIDATION_ERROR = "validation_error"
    DUPLICATE = "duplicate"
    UNKNOWN = "unknown"


class IngestProduct(BaseModel):
    sku: str
    merchant_id: str = ""
    title: str
    description: Optional[str] = None
    price: float
    currency: str = "SGD"
    region: str = "sg"
    country_code: str = "SG"
    url: str
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    is_active: bool = True
    is_available: bool = True
    in_stock: Optional[bool] = True
    stock_level: Optional[str] = None
    last_checked: Optional[Any] = None
    metadata: Optional[Dict[str, Any]] = None


class IngestRequest(BaseModel):
    source: str
    products: List[IngestProduct]


class IngestError(BaseModel):
    index: int = 0
    sku: Optional[str] = None
    error: str = ""
    code: IngestErrorCode = IngestErrorCode.UNKNOWN_ERROR
    # Legacy field
    message: str = ""


class ProductQualitySummary(BaseModel):
    sku: str
    score: float
    tier: str
    missing_required: List[str] = Field(default_factory=list)
    missing_optional: List[str] = Field(default_factory=list)


class IngestResponse(BaseModel):
    run_id: Optional[int] = None
    status: str = "ok"
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_failed: int = 0
    errors: List[IngestError] = Field(default_factory=list)
    quality_scores: List[ProductQualitySummary] = Field(default_factory=list)
    critical_fails: int = 0
    # Legacy fields
    inserted: int = 0
    updated: int = 0
