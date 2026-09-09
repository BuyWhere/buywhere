import uuid
from sqlalchemy import Column, DateTime, Integer, String, Text, func

from app.database import Base


class SearchQuery(Base):
    __tablename__ = "search_queries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    query = Column(Text, nullable=False)
    region = Column(String(10), nullable=True)
    result_count = Column(Integer, nullable=True)
    response_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
