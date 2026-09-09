# Docs-Site Design Audit — Surf BUY-77347
**Auditor:** Sketch
**Date:** 2026-08-29
**URL:** https://docs.buywhere.ai (Surf issue e5ed3516-027a-42f6-8d89-ff6b8315072b)
**Source:** `/home/paperclip/buywhere/docs-site/`
**Status:** Landing page DONE | Deploy BLOCKED (GitHub Actions secrets missing)

---

## Executive Summary

The BuyWhere API documentation site is **substantially complete** in content but **not yet deployed**. Content quality is high — developers can get an API key in 3 seconds, make their first call, and understand errors without any support. The deploy workflow exists but has never run; the nginx server root is empty and Cloudflare redirects `docs.buywhere.ai/*` → `buywhere.ai/*`.

Two design tasks needed:
1. **Deploy gate** — file a Surf issue to trigger the deploy
2. **Landing-page polish** — the root `/` renders the generic Docusaurus docs shell; needs a proper hero with live API key registration

---

## Content Audit ✓

| Page | Status | Notes |
|------|--------|-------|
| `/` (Getting Started) | ✅ Complete | Instant key registration, curl/Python/Node examples, pricing tiers table |
| `/authentication` | ✅ Complete | Bearer token usage, rate limits, error codes |
| `/errors` | ✅ Complete | All error codes with examples, retry guidance |
| `/api-reference/search` | ✅ Complete | Full parameter table, response schema, field list |
| `/api-reference/get-product` | ✅ Complete | |
| `/api-reference/compare` | ✅ Complete | |
| `/api-reference/deals` | ✅ Complete | |
| `/api-reference/categories` | ✅ Complete | |
| `/api-reference/similar` | ✅ Complete | |
| `/api-reference/price-history` | ✅ Complete | |
| `/api-reference/bulk` | ✅ Complete | |
| `/api-reference/webhooks` | ✅ Complete | |
| `/guides/price-comparison` | ✅ Complete | Full Python quickstart |
| `/guides/mcp-integration` | ✅ Complete | Claude Desktop, Cursor, Windsurf instructions |
| `/guides/mastra-integration` | ✅ Complete | Mastra agent integration guide |

Content quality: **excellent** — developer-centric, no fluff, working curl examples, correct response shapes.

---

## Design Audit

### CSS Customization
Only primary color overridden. Minimal investment.

```css
:root {
  --ifm-color-primary: #2563eb;  /* Blue — brand-consistent */
}
```

**Verdict:** Adequate for docs; does not stand out as a premium developer product.

### Missing Design Elements

1. **No custom landing page.** The root `/` renders the standard Docusaurus docs sidebar shell. There's no hero section, no animated terminal showing live API calls, no "Try it now" CTA. Developers land on a docs nav — lower-funnel content for a top-funnel audience.

2. **No docs-version banner / changelog.** When the API evolves, there's no visible changelog or versioning strategy.

3. **Social card image is generic.** `img/buywhere-social-card.png` — needs verification it renders correctly on Twitter/LinkedIn.

4. **Footer lacks community links.** No GitHub, no Discord, no community forum link.

5. **No search customization.** Default Docusaurus docsearch — no Algolia DocSearch config (would need an account).

---

## Deployment Status

### What Exists
- ✅ `docs-site/build/` — static output, ready to serve (built 2026-08-29)
- ✅ `.github/workflows/deploy-docs.yml` — CI workflow, triggers on `docs-site/**` push to main
- ✅ `deploy/nginx/docs.buywhere.ai.conf` — nginx config, certs provisioned
- ✅ `buywhere-social-card.png` — social sharing image

### What's Missing
- ❌ `/var/www/docs.buywhere.ai/` — nginx root is **empty** (deploy never ran)
- ❌ Cloudflare redirect — `docs.buywhere.ai/*` redirects to `buywhere.ai/*` (removes path info)
- ❌ No deploy has ever run — workflow is untested

### Deploy Path
1. Push any change to `docs-site/**` on `main`, **OR** manually dispatch `deploy-docs.yml` from GitHub Actions
2. `npm run build` generates static files in `docs-site/build/`
3. `rsync` pushes to `PRODUCTION_DEPLOY_HOST:/var/www/docs.buywhere.ai/`
4. Smoke test confirms HTTP 200

### Cloudflare Issue
Cloudflare currently returns 301 for `docs.buywhere.ai/*` → `buywhere.ai/*`, which strips the path. This must be removed (Cloudflare page rule or DNS-only proxy) before the deploy smoke test will hit the nginx server instead of the redirect target.

---

## Recommended Actions

### ✅ Priority 1 — Landing page hero (DESIGN DONE, committed 0a73a544c)

- Terminal hero with live curl example ✓
- Feature grid ✓
- Quickstart section with Python code card ✓
- MCP integration banner ✓
- GitHub navbar icon ✓
- Footer GitHub link ✓

### Priority 2 — Deploy the site (Flux/Surf)

Workflow exists but GitHub Actions secrets are missing:
- `PRODUCTION_DEPLOY_SSH_KEY`
- `PRODUCTION_DEPLOY_HOST`
- `PRODUCTION_DEPLOY_USER`

These must be configured in GitHub repo Settings → Secrets → Actions. Flux task.

Additionally, Cloudflare is redirecting `docs.buywhere.ai/*` → `buywhere.ai/*`. This redirect must be removed (DNS-only proxy) so requests hit the nginx server.

Deploy workflow ran once (commit 0a73a544c) but failed at SSH setup step — secrets not configured.

---

## Verification Checklist

- [x] `npx docusaurus build` completes clean (Docusaurus v3.10.1)
- [x] Landing page hero renders correctly (served locally, verified)
- [x] All doc routes accessible (`/docs/`, `/docs/getting-started/`, etc.)
- [x] All internal links resolved
- [ ] GitHub Actions secrets configured → Flux
- [ ] Cloudflare redirect removed → Richmond/ops
- [ ] `curl https://docs.buywhere.ai/` returns HTTP 200
- [ ] `buywhere-social-card.png` renders in Twitter card validator
- [ ] Dark mode toggle works
- [ ] Mobile viewport: hamburger nav + code scroll
- [ ] Docusaurus v3.10.1 → v3.10.2 upgrade (optional, low priority)
