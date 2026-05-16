from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class SearchHistory:
    developer_id: int
    api_key_id: int
    query: str
    filters: dict
    result_count: int


@dataclass
class SearchQuery:
    query: str
    region: Optional[str] = None
    result_count: int = 0
    response_ms: int = 0
    created_at: Optional[datetime] = None
