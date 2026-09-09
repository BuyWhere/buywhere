import uuid
from sqlalchemy import Boolean, Column, DateTime, Numeric, String, Text, func

from app.database import Base


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    developer_id = Column(Text, nullable=False, index=True)
    product_id = Column(Text, nullable=False, index=True)
    target_price = Column(Numeric(12, 2), nullable=False)
    direction = Column(String(10), nullable=False, default="below")  # 'below' or 'above'
    currency = Column(String(3), nullable=False, default="SGD")
    callback_url = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    triggered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
