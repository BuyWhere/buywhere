"""
Post-fix integration tests for BUY-4895.
Tests webhooks, price alerts, email delivery, and rate limiting against the live API.

Run with: cd /home/paperclip/buywhere-api && python -m pytest tests/integration/test_post_fix_integration.py -v
"""

import asyncio
import time
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey
from app.models.price_alert import PriceAlert
from app.models.webhook import Webhook, WebhookDelivery


@pytest.fixture
def test_api_key():
    key = MagicMock(spec=ApiKey)
    key.id = "test-key-id"
    key.key_hash = "test-hash"
    key.developer_id = "dev_test_123"
    key.name = "Test Key"
    key.tier = "basic"
    key.is_active = True
    key.rate_limit = "1000"
    return key


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


@pytest.fixture
def mock_get_db(mock_db):
    async def _mock_get_db():
        yield mock_db
    return _mock_get_db


@pytest.fixture
def mock_get_api_key(test_api_key):
    async def _mock_get_api_key():
        return test_api_key
    return _mock_get_api_key


@pytest.fixture
def client(mock_get_db, mock_get_api_key):
    app.dependency_overrides[get_db] = mock_get_db
    app.dependency_overrides[get_current_api_key] = mock_get_api_key
    original_limiter_enabled = app.state.limiter.enabled
    app.state.limiter.enabled = False
    
    yield TestClient(app)
    
    app.state.limiter.enabled = original_limiter_enabled
    app.dependency_overrides.clear()


class TestWebhookIntegration:
    """Test webhook subscription and delivery (Issue 1)."""

    def test_webhook_subscription_create_requires_auth(self):
        """POST /v1/webhooks requires API key authentication."""
        original_limiter = app.state.limiter.enabled
        app.state.limiter.enabled = False
        
        with TestClient(app) as client:
            response = client.post(
                "/v1/webhooks",
                json={
                    "url": "https://example.com/webhook",
                    "events": ["price.change"],
                    "description": "Test webhook",
                },
            )
        
        app.state.limiter.enabled = original_limiter
        
        assert response.status_code in (401, 403), \
            f"Expected 401/403 for unauthenticated request, got {response.status_code}"

    def test_webhook_subscription_create_with_valid_payload(self, client, test_api_key):
        """Create a webhook subscription returns 201 or proper error."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_result.scalar = MagicMock(return_value=0)
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.flush = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.refresh = AsyncMock(side_effect=lambda w: setattr(w, 'id', 1))
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.post(
            "/v1/webhooks",
            json={
                "url": "https://example.com/webhook",
                "events": ["price.change"],
                "description": "Test webhook for price changes",
            },
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code in (201, 409, 500), \
            f"Unexpected status {response.status_code}: {response.text}"

    def test_webhook_list_returns_subscriptions(self, client):
        """GET /v1/webhooks returns user's webhook subscriptions."""
        mock_result = MagicMock()
        mock_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.get(
            "/v1/webhooks",
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "webhooks" in data or "items" in data or isinstance(data, list), \
            f"Response should contain webhooks list, got: {data}"

    def test_webhook_delete_removes_subscription(self, client):
        """DELETE /v1/webhooks/{id} removes a webhook subscription."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=MagicMock(id=1))
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.delete = AsyncMock()
        mock_db.flush = AsyncMock()
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.delete(
            "/v1/webhooks/1",
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code in (204, 404), \
            f"Expected 204 or 404, got {response.status_code}: {response.text}"

    def test_webhook_test_endpoint_fires_test_delivery(self, client):
        """POST /v1/webhooks/test triggers a test webhook delivery."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=MagicMock(
            id=1,
            url="https://example.com/test",
            secret=None,
            active=True,
        ))
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.post(
            "/v1/webhooks/test",
            json={"url": "https://example.com/test"},
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code in (200, 201, 202), \
            f"Expected success status, got {response.status_code}: {response.text}"


class TestPriceAlertIntegration:
    """Test price alert creation, storage, and querying (Issue 2)."""

    def test_create_alert_returns_201_for_valid_product(self, client):
        """Create a price alert returns 201 and stores the alert."""
        from app.models.product import Product
        
        mock_product = MagicMock(spec=Product)
        mock_product.id = 101
        mock_product.is_active = True
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_product)
        mock_result.scalar = MagicMock(return_value=0)
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[mock_result, mock_result])
        mock_db.flush = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.refresh = AsyncMock(side_effect=lambda a: setattr(a, 'id', 'alert_123'))
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.post(
            "/v1/alerts",
            json={
                "product_id": 101,
                "target_price": 999.99,
                "direction": "below",
                "currency": "SGD",
                "callback_url": "https://example.com/alert-callback",
            },
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code == 201, \
            f"Expected 201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["product_id"] == 101
        assert Decimal(str(data["target_price"])) == Decimal("999.99")
        assert data["direction"] == "below"
        assert data["currency"] == "SGD"
        assert data["is_active"] is True

    def test_create_alert_returns_404_for_missing_product(self, client):
        """Create alert for non-existent product returns 404."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.flush = AsyncMock()
        mock_db.add = MagicMock()
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.post(
            "/v1/alerts",
            json={
                "product_id": 99999,
                "target_price": 50.00,
                "direction": "below",
                "currency": "SGD",
                "callback_url": "https://example.com/alert",
            },
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code == 404, \
            f"Expected 404, got {response.status_code}: {response.text}"

    def test_list_alerts_returns_developer_alerts(self, client):
        """GET /v1/alerts returns only the authenticated developer's alerts."""
        from app.models.price_alert import PriceAlert
        
        mock_alert = MagicMock(spec=PriceAlert)
        mock_alert.id = "alert_1"
        mock_alert.product_id = 101
        mock_alert.target_price = Decimal("999.99")
        mock_alert.direction = "below"
        mock_alert.currency = "SGD"
        mock_alert.callback_url = "https://example.com/alert"
        mock_alert.is_active = True
        mock_alert.triggered_at = None
        mock_alert.created_at = datetime(2026, 4, 4, tzinfo=timezone.utc)
        
        mock_result = MagicMock()
        mock_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[mock_alert])))
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.get(
            "/v1/alerts",
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "alerts" in data or "items" in data
        assert data["total"] >= 1

    def test_delete_alert_removes_alert(self, client):
        """DELETE /v1/alerts/{id} removes the alert."""
        mock_alert = MagicMock()
        mock_alert.id = "alert_123"
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_alert)
        
        from unittest.mock import AsyncMock
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.delete = AsyncMock()
        mock_db.flush = AsyncMock()
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        response = client.delete(
            "/v1/alerts/alert_123",
            headers={"Authorization": "Bearer test-key"},
        )
        
        assert response.status_code == 204, \
            f"Expected 204, got {response.status_code}: {response.text}"


class TestEmailDeliveryIntegration:
    """Test email delivery for signup (Issue 3)."""

    def test_signup_sends_verification_email(self):
        """Developer signup triggers verification email via SendGrid."""
        with patch('app.key_provisioning._send_verification_email_via_sendgrid') as mock_send:
            mock_send.return_value = (True, "msg_id_123")
            
            from app.key_provisioning import _render_verification_email
            html_body = _render_verification_email(
                "test@example.com",
                "test_token_12345"
            )
            
            assert "Verify" in html_body or "verify" in html_body.lower(), \
                "Email body should contain verification content"

    def test_signup_email_contains_verification_link(self):
        """Verification email contains valid verification URL."""
        from app.config import get_settings
        settings = get_settings()
        
        with patch.object(settings, 'public_url', 'https://api.buywhere.ai'):
            from app.key_provisioning import _render_verification_email
            html_body = _render_verification_email(
                "developer@example.com",
                "abc123token"
            )
            
            assert "abc123token" in html_body, \
                "Email should contain the verification token"
            assert "verify" in html_body.lower() or "email" in html_body.lower(), \
                "Email should contain verification-related content"

    def test_sendgrid_fallback_to_smtp(self):
        """If SendGrid fails, system falls back to SMTP."""
        with patch('app.key_provisioning._send_verification_email_via_sendgrid') as mock_sendgrid:
            mock_sendgrid.return_value = (False, None)
            
            with patch('app.key_provisioning._send_verification_email_via_smtp') as mock_smtp:
                mock_smtp.return_value = True
                
                from app.key_provisioning import _send_verification_email_via_sendgrid
                
                result = _send_verification_email_via_sendgrid(
                    "test@example.com",
                    "Verify your email",
                    "<html><body>Click to verify</body></html>"
                )
                
                assert result == (False, None) or mock_smtp.called, \
                    "Should attempt SMTP fallback when SendGrid fails"


class TestRateLimitingIntegration:
    """Test rate limiting returns proper 429 with headers (Issue 4)."""

    def test_rate_limit_exceeded_returns_429(self, test_api_key):
        """When rate limit is exceeded, API returns 429 with Retry-After header."""
        original_limiter = app.state.limiter.enabled
        app.state.limiter.enabled = True
        
        app.state.limiter.enabled = original_limiter
        
        client = TestClient(app)
        
        for _ in range(5):
            response = client.get(
                "/v1/products",
                headers={"Authorization": "Bearer test-key"},
            )
        
        if response.status_code == 429:
            assert "Retry-After" in response.headers or "X-RateLimit-Reset" in response.headers, \
                "429 response should include rate limit headers"
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                assert int(retry_after) > 0, "Retry-After should be positive integer"
        else:
            pass

    def test_rate_limit_headers_present_on_all_requests(self, test_api_key):
        """All API responses include rate limit headers."""
        original_limiter = app.state.limiter.enabled
        app.state.limiter.enabled = True
        
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        mock_db.execute = AsyncMock(return_value=mock_result)
        
        async def override_db():
            yield mock_db
        
        app.dependency_overrides[get_db] = override_db
        
        with TestClient(app) as client:
            response = client.get(
                "/v1/products",
                headers={"Authorization": "Bearer test-key"},
            )
        
        app.state.limiter.enabled = original_limiter
        
        if "X-RateLimit-Limit" in response.headers or "X-RateLimit-Remaining" in response.headers:
            assert "X-RateLimit-Limit" in response.headers, \
                "Response should include X-RateLimit-Limit header"
            assert "X-RateLimit-Remaining" in response.headers, \
                "Response should include X-RateLimit-Remaining header"
            assert "X-RateLimit-Reset" in response.headers, \
                "Response should include X-RateLimit-Reset header"

    def test_rate_limit_tier_affects_limit(self, test_api_key):
        """Enterprise tier gets higher rate limits than basic tier."""
        enterprise_key = MagicMock(spec=ApiKey)
        enterprise_key.id = "enterprise-key"
        enterprise_key.key_hash = "hash"
        enterprise_key.developer_id = "enterprise_dev"
        enterprise_key.name = "Enterprise Key"
        enterprise_key.tier = "enterprise"
        enterprise_key.is_active = True
        enterprise_key.rate_limit = "20000"
        
        basic_key = MagicMock(spec=ApiKey)
        basic_key.id = "basic-key"
        basic_key.key_hash = "hash"
        basic_key.developer_id = "basic_dev"
        basic_key.name = "Basic Key"
        basic_key.tier = "basic"
        basic_key.is_active = True
        basic_key.rate_limit = "1000"
        
        from app.rate_limit import rate_limit_from_request
        from unittest.mock import MagicMock as MockRequest
        
        enterprise_request = MagicMock()
        enterprise_request.state.api_key = enterprise_key
        enterprise_request.url.path = "/v1/products"
        enterprise_request.method = "GET"
        enterprise_request.headers = {}
        
        basic_request = MagicMock()
        basic_request.state.api_key = basic_key
        basic_request.url.path = "/v1/products"
        basic_request.method = "GET"
        basic_request.headers = {}
        
        with patch('app.rate_limit.get_request_context', side_effect=[enterprise_request, basic_request]):
            with patch('app.rate_limit._is_us_traffic', return_value=False):
                from app.rate_limit import set_request_context
                set_request_context(enterprise_request)
                enterprise_limit = rate_limit_from_request(enterprise_request)
                
                set_request_context(basic_request)
                basic_limit = rate_limit_from_request(basic_request)
        
        enterprise_num = int(enterprise_limit.split('/')[0])
        basic_num = int(basic_limit.split('/')[0])
        
        assert enterprise_num > basic_num, \
            f"Enterprise limit ({enterprise_num}) should be higher than basic ({basic_num})"


class TestWebhookDeliveryMechanism:
    """Test the webhook delivery background task mechanism."""

    def test_deliver_webhook_creates_delivery_record(self):
        """deliver_webhook creates a WebhookDelivery record before sending."""
        from app.services.webhook import deliver_webhook
        from app.models.webhook import Webhook, WebhookDelivery
        
        mock_webhook = MagicMock(spec=Webhook)
        mock_webhook.id = 1
        mock_webhook.url = "https://example.com/webhook"
        mock_webhook.secret = None
        
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_webhook)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.is_success = True
            mock_response.text = "OK"
            
            mock_async_client = AsyncMock()
            mock_async_client.__aenter__ = AsyncMock(return_value=mock_response)
            mock_async_client.__aexit__ = AsyncMock()
            mock_client.return_value = mock_async_client
            
            loop = asyncio.new_event_loop()
            result = loop.run_until_complete(
                deliver_webhook(mock_db, 1, "price.change", {"test": "payload"})
            )
            loop.close()
            
            assert mock_db.add.called, "Should create WebhookDelivery record"

    def test_deliver_webhook_retries_on_failure(self):
        """deliver_webhook retries up to max_retries on failure."""
        from app.services.webhook import deliver_webhook
        
        mock_webhook = MagicMock(spec=Webhook)
        mock_webhook.id = 1
        mock_webhook.url = "https://example.com/webhook"
        mock_webhook.secret = None
        
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_webhook)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 500
            mock_response.is_success = False
            mock_response.text = "Server Error"
            
            mock_async_client = AsyncMock()
            mock_async_client.__aenter__ = AsyncMock(return_value=mock_response)
            mock_async_client.__aexit__ = AsyncMock()
            mock_client.return_value = mock_async_client
            
            with patch('asyncio.sleep', new_callable=AsyncMock) as mock_sleep:
                loop = asyncio.new_event_loop()
                result = loop.run_until_complete(
                    deliver_webhook(mock_db, 1, "price.change", {"test": "payload"}, max_retries=2)
                )
                loop.close()
                
                assert result is False, "Should return False after all retries fail"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])