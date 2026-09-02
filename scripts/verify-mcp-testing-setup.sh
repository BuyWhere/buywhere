#!/usr/bin/env bash
# verify-mcp-testing-setup.sh — Verify MCP testing setup for Atlas QA agent
#
# Usage:
#   ./verify-mcp-testing-setup.sh
#
# This script verifies that the Atlas QA agent has the proper API key
# configuration for MCP continuous testing.

set -euo pipefail

echo "=== BUY-18067: Verify MCP testing setup for Atlas QA agent ==="
echo ""

# Configuration
AGENT_NAME="atlas-qa-agent"
DB_URL="${DATABASE_URL:-postgresql://localhost:5432/buywhere}"
TEST_ENDPOINT="${TEST_ENDPOINT:-https://api.buywhere.ai/mcp}"

echo "🔍 Checking database configuration..."
echo "Database: $DB_URL"
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "❌ psql CLI not found. Please install PostgreSQL client."
    exit 1
fi

# Check database connection
if ! psql "$DB_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Cannot connect to database: $DB_URL"
    echo "Please check the DATABASE_URL and database permissions."
    exit 1
fi

echo "✅ Database connection successful"
echo ""

# Check API key setup
echo "🔑 Checking API key setup..."
echo "Agent: $AGENT_NAME"
echo ""

API_KEY_INFO=$(psql "$DB_URL" -t -c "
SELECT 
  name,
  tier,
  is_active,
  rpm_limit,
  daily_limit,
  created_at,
  last_used_at
FROM api_keys 
WHERE name = '$AGENT_NAME' AND tier = 'enterprise';
")

if [ -n "$API_KEY_INFO" ]; then
    echo "✅ API key found:"
    echo "$API_KEY_INFO"
    echo ""
else
    echo "❌ API key not found for agent: $AGENT_NAME"
    echo ""
    echo "To set up the API key, run:"
    echo "  ./scripts/provision-mcp-testing-api-key.sh"
    exit 1
fi

# Check if key has been used
LAST_USED=$(psql "$DB_URL" -t -c "SELECT last_used_at FROM api_keys WHERE name = '$AGENT_NAME';" | tr -d ' ')
echo "Last used: ${LAST_USED:-Never}"
echo ""

# Check API key rate limits
echo "📊 Rate limits check:"
RPM_LIMIT=$(psql "$DB_URL" -t -c "SELECT rpm_limit FROM api_keys WHERE name = '$AGENT_NAME';" | tr -d ' ')
DAILY_LIMIT=$(psql "$DB_URL" -t -c "SELECT daily_limit FROM api_keys WHERE name = '$AGENT_NAME';" | tr -d ' ')

echo "  RPM limit: $RPM_LIMIT"
echo "  Daily limit: $DAILY_LIMIT"

if [ "$RPM_LIMIT" = "1000" ] && [ "$DAILY_LIMIT" = "100000" ]; then
    echo "✅ Enterprise rate limits configured correctly"
else
    echo "❌ Incorrect rate limits. Expected: 1000 RPM, 100000 daily"
fi
echo ""

# Check if endpoint is accessible
echo "🌐 Testing MCP endpoint access..."
echo "Endpoint: $TEST_ENDPOINT"
echo ""

# Test if the endpoint is accessible (without authentication)
if curl -s -o /dev/null -w "%{http_code}" "$TEST_ENDPOINT" | grep -q "200\|401"; then
    echo "✅ MCP endpoint is accessible"
    echo "   - Returns 200 (public methods available) or 401 (authentication required)"
else
    echo "❌ MCP endpoint not accessible"
    echo "   HTTP status: $(curl -s -o /dev/null -w "%{http_code}" "$TEST_ENDPOINT")"
fi
echo ""

# Generate configuration instructions
echo "⚙️  Atlas QA Agent Configuration Instructions"
echo ""
echo "Add the following configuration to your Atlas QA agent setup:"
echo ""
echo "```json"
echo "{"
echo "  \"mcp\": {"
echo "    \"buywhere\": {"
echo "      \"apiKey\": \"YOUR_API_KEY_HERE\","
echo "      \"serverUrl\": \"$TEST_ENDPOINT\","
echo "      \"tier\": \"enterprise\","
echo "      \"rateLimits\": {"
echo "        \"rpm\": 1000,"
echo "        \"daily\": 100000"
echo "      }"
echo "    }"
echo "  }"
echo "}"
echo "```"
echo ""
echo "Where YOUR_API_KEY_HERE is the actual API key value."
echo ""
echo "To get the actual API key:"
echo "  1. Run: gcloud secrets versions access latest --secret=buywhere-mcp-testing-api-key --project=gaia-calendar-488606"
echo "  2. Copy the output value"
echo ""
echo "🎉 Setup verification complete!"