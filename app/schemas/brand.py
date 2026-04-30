"""Brand schemas stub."""
from pydantic import BaseModel
from typing import List, Optional


class BrandResponse(BaseModel):
    name: str
    count: int = 0


class BrandListResponse(BaseModel):
    brands: List[BrandResponse] = []
    total: int = 0


class SourceInfo(BaseModel):
    name: str
    count: int = 0
    country: str = "SG"


class SourceListResponse(BaseModel):
    sources: List[SourceInfo] = []
    total: int = 0
