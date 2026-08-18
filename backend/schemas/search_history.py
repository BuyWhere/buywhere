"""Search history schemas stub."""
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class SearchHistoryEntry(BaseModel):
    id: str
    query: str
    created_at: datetime

    class Config:
        from_attributes = True


class SearchHistoryListResponse(BaseModel):
    items: List[SearchHistoryEntry] = []
    total: int = 0
