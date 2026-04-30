from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.auth import get_current_api_key
from app.database import get_db
from app.main import app
from app.models.price_alert import PriceAlert
from app.models.product import ApiKey, Product


def _result(*, scalar=None, one=None, all_values=None):
    result = MagicMock()
    result.scalar.return_value = scalar
    result.scalar_one_or_none.return_value = one
    result.scalars.return_value.all.return_value = all_values or []
    return result


def test_create_alert_returns_201_for_active_product():
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(
        side_effect=[
            _result(one=MagicMock(spec=Product)),
            _result(scalar=0),
            _result(one=None),
        ]
    )
    mock_db.flush = AsyncMock()
    mock_db.refresh = AsyncMock(
        side_effect=lambda alert: setattr(alert, "created_at", datetime(2026, 4, 4, tzinfo=timezone.utc))
    )
    mock_db.add = MagicMock()

    api_key = MagicMock(spec=ApiKey)
    api_key.developer_id = "dev_123"

    async def override_db():
        yield mock_db

    async def override_api_key():
        return api_key

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_api_key] = override_api_key
    original_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/alerts",
            json={
                "product_id": 101,
                "target_price": 999.99,
                "direction": "below",
                "currency": "sgd",
                "callback_url": "https://example.com/price-alert",
            },
        )

    app.state.limiter.enabled = original_enabled
    app.dependency_overrides.clear()

    assert response.status_code == 201
    data = response.json()
    assert data["product_id"] == 101
    assert data["direction"] == "below"
    assert data["currency"] == "SGD"
    assert data["callback_url"].startswith("https://example.com/price-alert")
    assert data["is_active"] is True
    mock_db.add.assert_called_once()


def test_create_alert_returns_404_for_missing_product():
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[_result(one=None)])
    mock_db.flush = AsyncMock()
    mock_db.add = MagicMock()

    api_key = MagicMock(spec=ApiKey)
    api_key.developer_id = "dev_123"

    async def override_db():
        yield mock_db

    async def override_api_key():
        return api_key

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_api_key] = override_api_key
    original_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/alerts",
            json={
                "product_id": 999,
                "target_price": 50,
                "direction": "below",
                "currency": "SGD",
                "callback_url": "https://example.com/price-alert",
            },
        )

    app.state.limiter.enabled = original_enabled
    app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "The requested resource was not found"
    mock_db.add.assert_not_called()


def test_list_alerts_returns_current_developer_alerts():
    alert = MagicMock(spec=PriceAlert)
    alert.id = "alert_1"
    alert.product_id = 101
    alert.target_price = Decimal("999.99")
    alert.direction = "below"
    alert.currency = "SGD"
    alert.callback_url = "https://example.com/price-alert"
    alert.is_active = True
    alert.triggered_at = None
    alert.created_at = datetime(2026, 4, 4, tzinfo=timezone.utc)

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[_result(all_values=[alert])])

    api_key = MagicMock(spec=ApiKey)
    api_key.developer_id = "dev_123"

    async def override_db():
        yield mock_db

    async def override_api_key():
        return api_key

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_api_key] = override_api_key
    original_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False

    with TestClient(app) as client:
        response = client.get("/api/v1/alerts")

    app.state.limiter.enabled = original_enabled
    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["limit"] == 100
    assert data["alerts"][0]["id"] == "alert_1"


def test_delete_alert_returns_404_for_unknown_alert():
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[_result(one=None)])
    mock_db.delete = AsyncMock()
    mock_db.flush = AsyncMock()

    api_key = MagicMock(spec=ApiKey)
    api_key.developer_id = "dev_123"

    async def override_db():
        yield mock_db

    async def override_api_key():
        return api_key

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_api_key] = override_api_key
    original_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False

    with TestClient(app) as client:
        response = client.delete("/api/v1/alerts/missing-alert")

    app.state.limiter.enabled = original_enabled
    app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "The requested resource was not found"
    mock_db.delete.assert_not_called()
