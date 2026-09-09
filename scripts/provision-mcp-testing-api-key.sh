#!/usr/bin/env bash
# provision-mcp-testing-api-key.sh — Provision enterprise BuyWhere API key for Atlas QA agent
#
# Usage:
#   ./provision-mcp-testing-api-key.sh
#
# This script:
# 1. Retrieves the buywhere-mcp-testing-api-key from GCP Secret Manager
# 2. Inserts it into the database as an enterprise API key for Atlas QA agent
# 3. Verifies the setup

set -euo pipefail

echo "=== BUY-18067: Provision enterprise BuyWhere API key for Atlas QA agent ==="
echo ""

# Configuration
GCP_PROJECT="gaia-calendar-488606"
SECRET_NAME="buywhere-mcp-testing-api-key"
AGENT_NAME="atlas-qa-agent"
DB_URL="${DATABASE_URL:-postgresql://localhost:5432/buywhere}"

# Step 1: Get API key from GCP Secret Manager
echo "🔑 Step 1: Retrieving API key from GCP Secret Manager..."
echo "Project: $GCP_PROJECT"
echo "Secret: $SECRET_NAME"
echo ""

# Check if gcloud is available and authenticated
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found. Please install and authenticate gcloud first."
    echo "   Install: https://cloud.google.com/sdk/docs/install"
    echo "   Auth: gcloud auth login"
    exit 1
fi

# Get the API key
API_KEY=$(gcloud secrets versions access latest \
    --secret="$SECRET_NAME" \
    --project="$GCP_PROJECT" \
    2>/dev/null)

if [ -z "$API_KEY" ]; then
    echo "❌ Failed to retrieve API key from Secret Manager."
    echo "   Check: "
    echo "   1. gcloud auth list"
    echo "   2. gcloud config get-value project"
    echo "   3. gcloud secrets describe $SECRET_NAME --project=$GCP_PROJECT"
    exit 1
fi

echo "✅ API key retrieved successfully"
echo "   Key length: ${#API_KEY} characters"
echo ""

# Step 2: Generate key hash and insert into database
echo "🗄️  Step 2: Setting up API key in database..."
echo "Agent: $AGENT_NAME"
echo "Tier: enterprise"
echo ""

# Check if we can connect to the database
if ! command -v psql &> /dev/null; then
    echo "❌ psql CLI not found. Please install PostgreSQL client."
    exit 1
fi

# Generate hash using the same logic as the API server
KEY_HASH=$(echo -n "$API_KEY" | sha256sum | cut -d' ' -f1)

# Create SQL to insert the API key
SQL_INSERT=$(cat <<EOF
-- Insert API key for Atlas QA agent with enterprise access
INSERT INTO api_keys (
  key_hash,
  name,
  tier,
  is_active,
  created_at,
  updated_at,
  rpm_limit,
  daily_limit,
  signup_channel
) VALUES (
  '$KEY_HASH',
  '$AGENT_NAME',
  'enterprise',
  true,
  NOW(),
  NOW(),
  1000,
  100000,
  'internal'
)
ON CONFLICT (key_hash) DO UPDATE SET
  name = '$AGENT_NAME',
  tier = 'enterprise',
  is_active = true,
  updated_at = NOW(),
  rpm_limit = 1000,
  daily_limit = 100000;
EOF
)

echo "Executing SQL..."
echo "$SQL_INSERT"
echo ""

# Execute the SQL
if echo "$SQL_INSERT" | psql "$DB_URL" > /dev/null 2>&1; then
    echo "✅ API key inserted successfully"
else
    echo "❌ Failed to insert API key. Check database connection and permissions."
    echo "   Database: $DB_URL"
    exit 1
fi

# Step 3: Verify the setup
echo ""
echo "🔍 Step 3: Verifying the setup..."

# Verify the key was inserted
VERIFICATION=$(psql "$DB_URL" -t -c "
SELECT name, tier, is_active, rpm_limit, daily_limit, created_at
FROM api_keys 
WHERE name = '$AGENT_NAME' AND tier = 'enterprise';
" | tr -d ' ')

if [ -n "$VERIFICATION" ]; then
    echo "✅ API key verified in database:"
    echo "$VERIFICATION"
else
    echo "❌ API key verification failed. Check the database."
    exit 1
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "=== Configuration Summary ==="
echo "Agent: $AGENT_NAME"
echo "Tier: enterprise"
echo "API Key: ${API_KEY:0:20}..."
echo "Rate Limits: 1000 RPM, 100000 daily"
echo ""
echo "The Atlas QA agent can now use this API key for MCP continuous testing."
echo "Set up the agent to use this key for authenticated tool calls."