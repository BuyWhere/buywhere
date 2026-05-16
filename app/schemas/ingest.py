"""Ingest schemas stub."""
from pydantic import BaseModel
from typing import List, Optional, Dict, Any


class IngestProduct(BaseModel):
    sku: str
    source: str
    title: str
    price: float
    currency: str = "SGD"
    url: str
    image_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class IngestRequest(BaseModel):
    products: List[IngestProduct]


class IngestResponse(BaseModel):
    inserted: int = 0
    updated: int = 0
    errors: int = 0


from enum import Enum


class IngestErrorCode(str, Enum):
    VALIDATION_ERROR = "validation_error"
    DUPLICATE = "duplicate"
    UNKNOWN = "unknown"


class IngestError(BaseModel):
    sku: Optional[str] = None
    code: IngestErrorCode = IngestErrorCode.UNKNOWN
    message: str = ""
