"""Agent search schemas stub."""
from pydantic import BaseModel
from typing import List, Optional


class AgentSearchRequest(BaseModel):
    query: str
    limit: int = 10


class AgentSearchResponse(BaseModel):
    results: List = []
    total: int = 0


class AgentSearchQuery(BaseModel):
    query: str
    region: str = "sg"
    limit: int = 10


class AgentSearchResult(BaseModel):
    id: str
    title: str
    price: Optional[float] = None
    currency: str = "SGD"
    url: str
    domain: str
