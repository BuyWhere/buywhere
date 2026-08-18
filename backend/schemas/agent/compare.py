"""Agent compare schemas stub."""
from pydantic import BaseModel
from typing import List, Optional


class AgentCompareRequest(BaseModel):
    product_ids: List[str]


class AgentCompareResponse(BaseModel):
    products: List = []


class AgentPriceComparisonRequest(BaseModel):
    query: str
    region: str = "sg"


class AgentPriceComparisonItem(BaseModel):
    title: str
    price: Optional[float] = None
    currency: str = "SGD"
    url: str
    domain: str


class AgentPriceComparisonResponse(BaseModel):
    results: List[AgentPriceComparisonItem] = []
    query: str = ""
