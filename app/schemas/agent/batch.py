"""Agent batch schemas stub."""
from pydantic import BaseModel
from typing import List


class AgentBatchRequest(BaseModel):
    queries: List[str]


class AgentBatchResponse(BaseModel):
    results: List = []


class AgentBatchLookupItem(BaseModel):
    query: str
    region: str = "sg"


class AgentBatchLookupRequest(BaseModel):
    queries: List[AgentBatchLookupItem]


class AgentBatchLookupResponse(BaseModel):
    results: List = []
