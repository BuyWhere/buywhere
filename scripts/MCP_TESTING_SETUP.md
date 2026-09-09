# BuyWhere MCP Testing Setup for Atlas QA Agent

This directory contains scripts for provisioning and managing the enterprise BuyWhere API key for Atlas QA agent MCP continuous testing.

## Overview

Issue: **BUY-18067** - Provision enterprise BuyWhere API key for Atlas QA agent

The Atlas QA agent needs an enterprise-level API key to run authenticated MCP tool calls for continuous testing. This key is stored in GCP Secret Manager and needs to be configured in the database.

## Files

### `provision-mcp-testing-api-key.sh`
Provisions the enterprise API key for the Atlas QA agent by:
1. Retrieving the API key from GCP Secret Manager
2. Inserting it into the database with enterprise tier access
3. Setting up proper rate limits (1000 RPM, 100000 daily)

**Usage:**
```bash
./scripts/provision-mcp-testing-api-key.sh
```

**Requirements:**
- gcloud CLI authenticated and configured
- Access to GCP project `gaia-calendar-488606`
- Database access (PostgreSQL client installed)

### `verify-mcp-testing-setup.sh`
Verifies that the Atlas QA agent has the proper API key configuration and provides setup instructions.

**Usage:**
```bash
./scripts/verify-mcp-testing-setup.sh
```

## Setup Process

### 1. Prerequisites
Ensure you have the following:
- gcloud CLI installed and authenticated
- PostgreSQL client installed
- Database connection access

### 2. Provision the API Key
```bash
./scripts/provision-mcp-testing-api-key.sh
```

This script will:
- Retrieve `buywhere-mcp-testing-api-key` from GCP Secret Manager
- Insert it into the `api_keys` table as an enterprise key
- Set proper rate limits for testing

### 3. Verify the Setup
```bash
./scripts/verify-mcp-testing-setup.sh
```

This script will:
- Check that the API key exists in the database
- Verify enterprise tier configuration
- Test MCP endpoint accessibility
- Provide configuration instructions

### 4. Configure Atlas QA Agent
Use the configuration output from the verification script to set up the Atlas QA agent with the API key.

## API Key Details

- **Secret Name**: `buywhere-mcp-testing-api-key`
- **Project**: `gaia-calendar-488606`
- **Tier**: Enterprise
- **Rate Limits**: 1000 RPM, 100000 daily
- **Agent**: `atlas-qa-agent`

## Troubleshooting

### gcloud authentication issues
```bash
# Check current authentication
gcloud auth list

# Login if needed
gcloud auth login

# Set project
gcloud config set project gaia-calendar-488606
```

### Database connection issues
```bash
# Test database connection
psql "$DATABASE_URL" -c "SELECT 1;"

# If DATABASE_URL is not set, use the default
psql postgresql://localhost:5432/buywhere -c "SELECT 1;"
```

### Secret Manager access issues
```bash
# Check if secret exists
gcloud secrets describe buywhere-mcp-testing-api-key --project=gaia-calendar-488606

# Check access permissions
gcloud secrets get-iam-policy buywhere-mcp-testing-api-key --project=gaia-calendar-488606
```

## Database Schema

The API key is stored in the `api_keys` table with these relevant fields:
- `key_hash`: SHA-256 hash of the API key
- `name`: Agent identifier (`atlas-qa-agent`)
- `tier`: Access tier (`enterprise`)
- `is_active`: Boolean flag
- `rpm_limit`: Per-minute rate limit
- `daily_limit`: Daily rate limit
- `signup_channel`: Source of the key (`internal`)

## MCP Server Integration

The MCP server middleware validates API keys using:
1. Hash-based lookup in the database
2. Rate limiting tracking in Redis
3. Tier-based access control

Enterprise tier allows:
- 1000 requests per minute
- 100,000 requests per day
- Full access to all MCP tools

## Security Notes

- API keys are stored as SHA-256 hashes in the database
- The raw key is only stored in GCP Secret Manager
- Never commit API keys to version control
- Use environment variables or secret management in production