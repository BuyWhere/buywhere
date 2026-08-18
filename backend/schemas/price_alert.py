from typing import List, Literal, Optional
from datetime import datetime
from decimal import Decimal

from pydantic import AnyHttpUrl, BaseModel, Field, field_validator


class AlertCreateRequest(BaseModel):
    product_id: int = Field(..., description="Product ID to monitor")
    target_price: Decimal = Field(..., gt=0, description="Trigger alert when price crosses target in the specified direction")
    direction: Literal["below", "above"] = Field(default="below", description="Direction: 'below' or 'above'")
    currency: str = Field(default="SGD", description="Currency for target price")
    callback_url: AnyHttpUrl = Field(..., description="Webhook URL to call when price condition is met")

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3:
            raise ValueError("currency must be a 3-letter ISO code")
        return normalized


class AlertResponse(BaseModel):
    id: str
    product_id: int
    target_price: float
    direction: str
    currency: str
    callback_url: str
    is_active: bool
    triggered_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertListResponse(BaseModel):
    alerts: List[AlertResponse]
    total: int
    limit: int = 100
