# BuyWhere Agent Onboarding Playbook
## Standard Integration Guide for AI Agent Developers

A comprehensive playbook for AI agent developers to successfully integrate with BuyWhere's agent-native product catalog API. This guide covers everything from initial setup to advanced patterns and production deployment.

## Table of Contents
1. [Quickstart Guide](#quickstart-guide)
2. [Core Concepts](#core-concepts)
3. [Authentication & Security](#authentication--security)
4. [API Fundamentals](#api-fundamentals)
5. [Agent-Native Features](#agent-native-features)
6. [Integration Patterns](#integration-patterns)
7. [Best Practices](#best-practices)
8. [Performance Optimization](#performance-optimization)
9. [Error Handling & Troubleshooting](#error-handling--troubleshooting)
10. [Advanced Usage](#advanced-usage)
11. [Production Checklist](#production-checklist)
12. [Reference Implementations](#reference-implementations)
13. [Getting Help](#getting-help)

---

## Quickstart Guide

Follow these steps to make your first API call in under 5 minutes:

### 1. Get Your API Key
```bash
# For development - bootstrap your first key
curl -X POST http://localhost:8000/keys/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"name":"My AI Agent"}'

# Response includes your raw_key - SAVE THIS SECURELY
# {
#   "key_id": "uuid-of-your-key",
#   "raw_key": "bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
#   "name": "My AI Agent",
#   "tier": "basic"
# }
```

### 2. Test Connectivity
```bash
curl https://api.buywhere.ai/health
# Expected: {"status":"ok"}
```

### 3. Make Your First Request
```bash
curl "https://api.buywhere.ai/v2/products?q=wireless%20headphones&limit=3" \
  -H "Authorization: Bearer bw_live_your_api_key_here"
```

You should see a JSON response with product data including agent-optimized fields like `confidence_score` and `availability_prediction`.

---

## Core Concepts

### Agent-Native API Design
BuyWhere's v2 API is specifically designed for AI agents with:
- **Structured data**: Consistent schemas for reliable parsing
- **Quality signals**: `confidence_score` (0.0-1.0) indicates data reliability
- **Predictive fields**: `availability_prediction`, `price_trend` for decision making
- **Batch operations**: Efficiently process multiple products
- **Discovery endpoints**: `/agents/explore` and `/trending` for serendipitous discovery

### Data Quality Indicators
Always check these fields when processing product data:
- `confidence_score`: Filter for > 0.8 for reliable data
- `availability_prediction`: Prioritize "high" availability
- `updated_at`: Verify data freshness
- `competitor_count`: Indicates market saturation

### Rate Limiting
Understand and respect rate limits:
- Free tier: 100 requests/minute
- Basic tier: 500 requests/minute  
- Pro tier: 1,000 requests/minute
- Enterprise: Custom limits

Check response headers:
- `X-RateLimit-Limit`: Your allowance
- `X-RateLimit-Remaining`: Requests left
- `X-RateLimit-Reset`: Reset timestamp (Unix)
- `Retry-After`: Seconds to wait on 429

---

## Authentication & Security

### API Key Management
- **Format**: `bw_live_` (production) or `bw_test_` (sandbox)
- **Header**: `Authorization: Bearer YOUR_KEY`
- **Security**: Never expose keys in client-side code or public repos
- **Rotation**: Keys can be regenerated via API dashboard

### JWT Alternative
For server-to-server authentication, you can use JWT tokens:
```bash
# Exchange API key for JWT
curl -X POST https://api.buywhere.ai/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key": "bw_live_your_key"}'

# Returns: {"access_token": "jwt_token", "expires_in": 3600}
```

### Environment Separation
- **Development**: Use `bw_test_` keys with sandbox endpoints
- **Staging**: Test with production-like data
- **Production**: Use `bw_live_` keys with `api.buywhere.ai`

---

## API Fundamentals

### Product Search (`GET /v2/products`)
Primary endpoint for discovering products:
```http
GET /v2/products?q=search+term&limit=10&offset=0
```

Key parameters:
- `q`: Search query (required)
- `limit`: Results per page (1-100, default 10)
- `offset`: Pagination offset
- `min_price`/`max_price`: Price filters (in SGD)
- `currency`: Target currency (SGD, USD, etc.)
- `sort_by`: `relevance`, `price_asc`, `price_desc`, `rating`

Response structure:
```json
{
  "total": 1247,
  "limit": 10,
  "offset": 0,
  "items": [
    {
      "id": 78234,
      "name": "Product Name",
      "price": "449.00",
      "currency": "SGD",
      "confidence_score": 0.95,
      "availability_prediction": "high",
      "competitor_count": 12,
      "price_trend": "stable",
      "buy_url": "https://merchant.com/product",
      "affiliate_url": "https://api.buywhere.ai/v1/track/abc123"
    }
  ],
  "has_more": true
}
```

### Product Details (`GET /v2/products/{id}`)
Get detailed information for a specific product:
```http
GET /v2/products/78234
```

Returns single product object with expanded fields including specifications, images, and merchant information.

### Batch Details (`POST /v2/products/batch-details`)
Efficiently fetch multiple products (max 100 IDs):
```http
POST /v2/products/batch-details
Content-Type: application/json

{
  "product_ids": [78234, 78235, 78236]
}
```

Returns array of product objects in the same format as individual details.

### Discovery Endpoints
- **Trending**: `GET /v2/trending?category=electronics&limit=10`
- **Explore**: `GET /v2/agents/explore?category=fashion&limit=20` (randomized sample)
- **Categories**: `GET /v2/categories` for browsing by category

---

## Agent-Native Features

### Confidence Scoring
The `confidence_score` (0.0-1.0) indicates data reliability:
- **0.9-1.0**: High confidence, verified data
- **0.7-0.9**: Good confidence, minor uncertainties
- **0.5-0.7**: Moderate confidence, verify if critical
- **<0.5**: Low confidence, consider as placeholder

**Best Practice**: Filter results with `confidence_score > 0.8` for production use.

### Availability Prediction
Forecast of stock levels:
- `"high"`: Likely in stock
- `"medium"`: May be limited availability  
- `"low"`: Likely out of stock or scarce
- `"unknown"`: Insufficient data for prediction

**Best Practice**: Prioritize items with `"availability_prediction": "high"` for immediate purchase recommendations.

### Competitive Intelligence
- `competitor_count`: Number of sellers offering same product
- `price_trend`: Recent movement (`"up"`, `"down"`, `"stable"`)
- `buy_url`/`affiliate_url`: Direct and tracked purchase links

These enable sophisticated price comparison and deal detection agents.

---

## Integration Patterns

### 1. Product Search Agent
Basic pattern for finding products based on user queries:
```python
class ProductSearchAgent:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.buywhere.ai/v2"
        self.headers = {"Authorization": f"Bearer {api_key}"}
    
    def search(self, query, limit=10):
        response = requests.get(
            f"{self.base_url}/products",
            headers=self.headers,
            params={"q": query, "limit": limit}
        )
        return self._filter_results(response.json())
    
    def _filter_results(self, data):
        # Filter for high-confidence, available products
        return [
            p for p in data['items']
            if p.get('confidence_score', 0) > 0.8
            and p.get('availability_prediction') == 'high'
        ]
```

### 2. Price Comparison Agent
Find best price across multiple platforms:
```python
class PriceComparisonAgent:
    def __init__(self, api_key):
        self.agent = ProductSearchAgent(api_key)
    
    def find_best_price(self, product_name):
        # Search for product
        results = self.agent.search(product_name, limit=5)
        if not results:
            return None
            
        # Get detailed info for top results
        product_ids = [p['id'] for p in results[:3]]
        details = self._get_batch_details(product_ids)
        
        # Find best price
        return min(details, key=lambda p: float(p['price']))
    
    def _get_batch_details(self, product_ids):
        # Implementation using /batch-details endpoint
        pass
```

### 3. Deal Detection Agent
Identify products likely to be good deals:
```python
class DealDetectionAgent:
    def scan_for_deals(self, max_price=100):
        results = self.agent.search("", limit=50, max_price=max_price)
        
        deals = []
        for product in results:
            # Heuristic: falling price + high confidence + good availability
            score = 0
            if product.get('confidence_score', 0) > 0.8:
                score += 0.3
            if product.get('availability_prediction') == 'high':
                score += 0.3
            if product.get('price_trend') == 'down':
                score += 0.4
                
            if score >= 0.7:  # Threshold for "good deal"
                deals.append({
                    'product': product,
                    'deal_score': score
                })
        
        return sorted(deals, key=lambda x: x['deal_score'], reverse=True)[:10]
```

### 4. Market Analysis Agent
Analyze trends and market conditions:
```python
class MarketAnalysisAgent:
    def analyze_category(self, category="electronics"):
        # Get trending products
        trending = self._get_trending(category, limit=20)
        
        # Get exploratory sample for broader view
        exploratory = self._get_explore(category, limit=20)
        
        # Analyze metrics
        return {
            'trending_count': len(trending),
            'price_moving_up': len([p for p in trending if p.get('price_trend') == 'up']),
            'price_moving_down': len([p for p in trending if p.get('price_trend') == 'down']),
            'avg_confidence': sum(p.get('confidence_score', 0) for p in trending) / len(trending),
            'high_availability_pct': len([p for p in trending if p.get('availability_prediction') == 'high']) / len(trending)
        }
```

---

## Best Practices

### Data Quality
1. **Always filter by confidence**: `confidence_score > 0.8`
2. **Check availability**: Prefer `"availability_prediction": "high"`
3. **Validate freshness**: Check `updated_at` timestamp (ISO 8601 format)
4. **Handle missing data**: Use `.get(field, default)` for optional fields

### Performance Optimization
1. **Use batch endpoints**: For >1 product, use `/batch-details` (100 IDs max)
2. **Implement caching**: Cache frequent queries for 5-15 minutes
3. **Leverage pagination**: Use `limit` and `offset` for large result sets
4. **Prefetch related data**: Get details for search results in batch

### Rate Limit Management
1. **Monitor headers**: Check `X-RateLimit-Remaining` in every response
2. **Implement backoff**: Exponential backoff for 429 responses
3. **Queue requests**: Implement request queuing to smooth traffic
4. **Consider tier upgrades**: Move to Basic/Pro for higher limits

### Error Handling
1. **Handle 401**: Invalid/expired API key
2. **Handle 429**: Rate limited - retry after delay
3. **Handle 5xx**: Temporary server issues - retry with backoff
4. **Validate responses**: Check for expected fields before processing

### Security
1. **Never expose API keys**: Use environment variables or secret managers
2. **Use HTTPS**: All API calls must be to `https://api.buywhere.ai`
3. **Validate inputs**: Sanitize user queries to prevent injection
4. **Log responsibly**: Never log full API keys

---

## Performance Optimization

### Caching Strategies
```python
class CachedBuyWhereAgent:
    def __init__(self, api_key):
        self.agent = BuyWhereAgent(api_key)
        self.cache = {}
        self.ttl = 300  # 5 minutes
    
    def _get_cache_key(self, method, *args):
        return f"{method}:{hash(str(args))}"
    
    def search(self, query, limit=10):
        cache_key = self._get_cache_key("search", query, limit)
        
        if cache_key in self.cache:
            result, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.ttl:
                return result
        
        result = self.agent.search(query, limit)
        self.cache[cache_key] = (result, time.time())
        return result
```

### Batch Processing
```python
def process_product_list(agent, product_ids):
    # Process in batches of 100 (API limit)
    batch_size = 100
    results = []
    
    for i in range(0, len(product_ids), batch_size):
        batch = product_ids[i:i+batch_size]
        batch_results = agent.get_batch_details(batch)
        results.extend(batch_results)
        
        # Be nice to the API - small delay between batches
        if i + batch_size < len(product_ids):
            time.sleep(0.1)
    
    return results
```

### Connection Pooling
Use HTTP connection pooling for better performance:
```python
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def create_session():
    session = requests.Session()
    
    # Retry strategy
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    return session
```

---

## Error Handling & Troubleshooting

### Common Error Patterns

#### 401 Unauthorized
```json
{"detail": "Invalid or revoked API key"}
```
**Solutions**:
- Verify API key format (`bw_live_` or `bw_test_`)
- Check for extra whitespace in key
- Ensure correct environment (live vs test)
- Regenerate key if expired/revoked

#### 429 Rate Limited
```json
{"detail": "Rate limit exceeded. Retry after 43 seconds."}
```
**Solutions**:
- Respect `Retry-After` header
- Implement exponential backoff
- Cache aggressively
- Consider upgrading API tier

#### 422 Validation Error
```json
{
  "detail": [
    {
      "loc": ["query", "limit"],
      "msg": "ensure this value is less than or equal to 100",
      "type": "value_error.not_le"
    }
  ]
}
```
**Solutions**:
- Check the `loc` field for problematic parameter
- Fix request format per validation message
- Refer to API documentation for parameter constraints

#### 500 Internal Server Error
```json
{"detail": "Internal server error"}
```
**Solutions**:
- Retry after brief delay (1-5 seconds)
- Check status.buywhere.ai for incidents
- Contact support if persistent

### Diagnostic Checklist
When troubleshooting, verify:
1. [ ] API key starts with `bw_live_` or `bw_test_`
2. [ ] Header is exactly `Authorization: Bearer YOUR_KEY`
3. [ ] No whitespace/newlines in key
4. [ ] Using correct environment (production vs sandbox)
5. [ ] Under rate limit (check `X-RateLimit-Remaining`)
6. [ ] Valid request parameters
7. [ ] Network connectivity (try `/health` endpoint)

### Quick Diagnostic Command
```bash
curl https://api.buywhere.ai/health \
  -H "Authorization: Bearer bw_live_YOUR_KEY" \
  -v  # Verbose to see headers
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "environment": "production"
}
```

---

## Advanced Usage

### Webhooks for Real-time Updates
Subscribe to product changes:
```bash
curl -X POST https://api.buywhere.ai/v1/webhooks \
  -H "Authorization: Bearer bw_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-agent.com/webhook/buywhere",
    "events": ["product.price_changed", "product.availability_changed"],
    "filters": {
      "categories": ["electronics", "fashion"],
      "min_confidence": 0.8
    }
  }'
```

### Price Alerts
Set up notifications for price changes:
```bash
curl -X POST https://api.buywhere.ai/v1/price-alerts \
  -H "Authorization: Bearer bw_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": 78234,
    "target_price": 399.00,
    "condition": "below",
    "notification_method": "webhook",
    "webhook_url": "https://your-agent.com/alerts/price"
  }'
```

### Affiliate Earnings Tracking
Track conversions and earnings:
```bash
# Get click-through URL
curl "https://api.buywhere.ai/v1/track/click?product_id=78234&agent_id=your_agent_id"

# Later, check conversions
curl -H "Authorization: Bearer bw_live_YOUR_KEY" \
  "https://api.buywhere.ai/v1/affiliate/earnings?start_date=2026-04-01&end_date=2026-04-30"
```

### Analytics & Insights
Access usage analytics:
```bash
# Get your API usage stats
curl -H "Authorization: Bearer bw_live_YOUR_KEY" \
  "https://api.buywhere.ai/v1/agent/analytics?period=30d"

# Get popular queries in your niche
curl -H "Authorization: Bearer bw_live_YOUR_KEY" \
  "https://api.buywhere.ai/v1/agent/market-insights?category=electronics"
```

---

## Production Checklist

### Pre-Launch
- [ ] API key stored securely (environment variable/secret manager)
- [ ] Error handling implemented for all HTTP status codes
- [ ] Rate limit monitoring and backoff in place
- [ ] Caching strategy implemented for frequent queries
- [ ] Data validation for all API responses
- [ ] Logging implemented (without API keys)
- [ ] Tested with sandbox/test API key
- [ ] Load tested expected traffic patterns

### Launch
- [ ] Monitoring dashboard set up for API health
- [ ] Alerting configured for error rate spikes
- [ ] Performance benchmarks established
- [ ] Documentation for internal team completed
- [ ] Support contact information readily available

### Post-Launch (Weekly)
- [ ] Review API usage metrics and rate limit headers
- [ ] Check error logs for patterns
- [ ] Validate data quality samples
- [ ] Review and optimize caching strategy
- [ ] Check for API version updates
- [ ] Review affiliate earnings and conversion rates

### Monthly
- [ ] Evaluate API tier adequacy (consider upgrading)
- [ ] Review and update integration based on new features
- [ ] Audit security practices (key rotation, access logs)
- [ ] Benchmark performance against SLAs
- [ ] Gather user feedback on product recommendations

---

## Reference Implementations

### Python SDK Usage
```python
from buywhere_sdk import BuyWhere
import asyncio

# Initialize client
client = BuyWhere(api_key="bw_live_YOUR_KEY")

# Synchronous usage
products = client.search("gaming laptop", limit=10)
high_confidence = [p for p in products if p.confidence_score > 0.8]

# Asynchronous usage
async def get_product_details(product_id):
    return await client.get_product(product_id)

# Batch processing
product_ids = [p.id for p in products[:50]]
details = client.get_batch_details(product_ids)

# Price comparison
best_price = client.compare_prices(
    "iPhone 15 Pro",
    retailers=["amazon", "shopee", "lazada"]
)
```

### JavaScript/TypeScript Usage
```javascript
import { BuyWhereClient } from '@buywhere/sdk';

// Initialize
const client = new BuyWhereClient('bw_live_YOUR_KEY');

// Search
const results = await client.search({
  q: 'wireless headphones',
  limit: 10,
  min_confidence: 0.8
});

// Get details
const product = await client.getProduct('78234');

// Batch details
const products = await client.getBatchDetails([
  '78234', '78235', '78236'
]);

// Real-time updates with webhooks
// (Would typically be handled by your backend)
```

### curl Examples for Common Tasks
```bash
# Search with filters
curl "https://api.buywhere.ai/v2/products?q=laptop&max_price=1500&limit=5" \
  -H "Authorization: Bearer bw_live_YOUR_KEY"

# Get trending in category
curl "https://api.buywhere.ai/v2/trending?category=electronics&limit=10" \
  -H "Authorization: Bearer bw_live_YOUR_KEY"

# Batch product lookup
curl -X POST "https://api.buywhere.ai/v2/products/batch-details" \
  -H "Authorization: Bearer bw_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"product_ids": [12345, 67890, 11111, 22222, 33333]}'

# Create price alert
curl -X POST "https://api.buywhere.ai/v1/price-alerts" \
  -H "Authorization: Bearer bw_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": 78234,
    "target_price": 400.00,
    "condition": "below"
  }'
```

---

## Getting Help

### Documentation
- **API Reference**: https://docs.buywhere.ai/api-reference
- **SDK Documentation**: https://github.com/buywhere/sdk
- **Integration Examples**: https://github.com/buywhere/examples
- **Architecture Guide**: https://docs.buywhere.ai/architecture

### Support Channels
- **Technical Issues**: support@buywhere.ai
- **API Status**: https://status.buywhere.ai
- **Developer Community**: https://community.buywhere.ai
- **Issue Tracking**: https://github.com/buywhere/api/issues

### When Contacting Support
Include:
1. Your API key prefix (e.g., `bw_live_abc12...` - never the full key)
2. The failed request (endpoint, method, parameters)
3. Full error response (including headers if possible)
4. Timestamp of failure (include timezone)
5. Expected vs actual behavior
6. Steps to reproduce (if applicable)

### Quick Reference
- **Health Check**: `curl https://api.buywhere.ai/health`
- **Rate Limit Info**: Check `X-RateLimit-*` headers in any response
- **API Versions**: v1 (legacy), v2 (current, agent-optimized)
- **Default Currency**: SGD (Singapore Dollars)
- **Base URL**: `https://api.buywhere.ai`
- **Timeout Recommendation**: 10 seconds for most endpoints

---

## Appendix: Agent-Specific Use Cases

### Shopping Assistant Agent
Helps users find and compare products:
```python
class ShoppingAssistant:
    def __init__(self, api_key):
        self.client = BuyWhere(api_key)
    
    def help_user_find_product(self, user_query, budget=None):
        # Parse user intent
        filters = {}
        if budget:
            filters['max_price'] = budget
            
        # Search
        results = self.client.search(user_query, limit=10, **filters)
        
        # Format for conversation
        return self._format_for_chat(results)
    
    def compare_options(self, product_names):
        # Get details for multiple products
        all_products = []
        for name in product_names:
            results = self.client.search(name, limit=3)
            all_products.extend(results)
        
        # Deduplicate and rank
        unique_products = self._deduplicate_by_id(all_products)
        ranked = self._rank_by_value(unique_products)
        
        return ranked[:5]  # Top 5 options
```

### Deal Hunter Agent
Finds and alerts on time-sensitive deals:
```python
class DealHunterAgent:
    def __init__(self, api_key, alert_callback):
        self.client = BuyWhere(api_key)
        self.alert_callback = alert_callback
        self.seen_deals = set()
    
    def scan_category(self, category, max_price=None):
        # Get recent/trending products
        params = {'limit': 50}
        if max_price:
            params['max_price'] = max_price
            
        results = self.client.search("", category=category, **params)
        
        # Find deals
        deals = self._identify_deals(results)
        
        # Alert on new deals
        new_deals = [d for d in deals if d['id'] not in self.seen_deals]
        for deal in new_deals:
            self.seen_deals.add(deal['id'])
            self.alert_callback(deal)
        
        return new_deals
    
    def _identify_deals(self, products):
        deals = []
        for p in products:
            score = 0
            if p.get('confidence_score', 0) > 0.85:
                score += 0.3
            if p.get('availability_prediction') == 'high':
                score += 0.2
            if p.get('price_trend') == 'down':
                score += 0.3
            if p.get('competitor_count', 0) > 5:  # Competitive market
                score += 0.2
                
            if score >= 0.7:
                deals.append({
                    'product': p,
                    'deal_score': score,
                    'reason': self._explain_deal(p)
                })
        return deals
```

### Market Intelligence Agent
Provides insights for business decisions:
```python
class MarketIntelligenceAgent:
    def __init__(self, api_key):
        self.client = BuyWhere(api_key)
    
    def get_category_report(self, category):
        # Get multiple data points
        trending = self.client.get_trending(category=category, limit=30)
        explore = self.client.get_explore(category=category, limit=30)
        
        # Analyze pricing
        price_analysis = self._analyze_pricing(trending + explore)
        
        # Analyze availability
        availability = self._analyze_availability(trending + explore)
        
        # Competitive landscape
        competition = self._analyze_competition(trending)
        
        return {
            'category': category,
            'timestamp': datetime.now().isoformat(),
            'sample_size': len(trending) + len(explore),
            'pricing': price_analysis,
            'availability': availability,
            'competition': competition,
            'recommendations': self._generate_recommendations(
                price_analysis, availability, competition
            )
        }
```

---
*Last updated: $(date)*  
*Version: 1.0.0*  
*For agent developers integrating with BuyWhere's agent-native product catalog API*