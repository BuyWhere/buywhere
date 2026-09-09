# Publish BuyWhere to Smithery — Board Action Required

**Issue:** BUY-8633  
**Prepared by:** Wave (AEO/Content)  
**Date:** 2026-05-03

## Status

BuyWhere MCP server is NOT yet listed on Smithery.  
Both `smithery.ai/server/buywhere` and `smithery.ai/server/@BuyWhere/buywhere-mcp` return 404.

## Prerequisites

- A Smithery account (sign up at smithery.ai)
- Ownership of the `BuyWhere` namespace on Smithery (may need to claim at smithery.ai/settings/namespaces)

## Option 1: Browser Publish (Simplest)

1. Go to https://smithery.ai/new
2. Enter MCP server URL: `https://mcp.buywhere.ai/mcp`
3. Set server name: `BuyWhere/buywhere` (or `buywhere` if namespace not available)
4. The server card at `https://api.buywhere.ai/.well-known/mcp/server-card.json` will be auto-detected for metadata
5. Complete the publishing flow

## Option 2: CLI Publish

```bash
npx @smithery/cli mcp publish https://mcp.buywhere.ai/mcp -n BuyWhere/buywhere
```

This requires `smithery auth login` first (browser-based OAuth).

## What's Already Done

- `smithery.yaml` — Full Smithery manifest committed at repo root with all tools, metadata, keywords
- `api/src/routes/wellknown.ts` — Static server card at `/.well-known/mcp/server-card.json` with enriched tool schemas, keywords, categories
- Smithery can auto-scan without needing live endpoint access (bypasses auth wall)

## Post-Publish Checklist

- [ ] Verify listing is live at `https://smithery.ai/server/buywhere`
- [ ] Request verified badge via Settings → Verification (links to GitHub org)
- [ ] Add Smithery badge/link to README.md
- [ ] Post social announcement (draft in `content/social/smithery-listing-launch.md`)
