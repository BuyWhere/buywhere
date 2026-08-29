# Docs-Site Design Audit — BUY-XXXXX
**Auditor:** Sketch
**Date:** 2026-08-29
**URL:** https://docs.buywhere.ai (not yet live)
**Source:** `/home/paperclip/buywhere/docs-site/`

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

### Priority 1 — Deploy the site (Flux/Surf)

File a Surf issue to manually dispatch the `deploy-docs.yml` workflow OR push a trivial change (e.g. update a comment in `docs-site/docusaurus.config.ts`) to trigger the push-to-main deploy.

Then remove the Cloudflare redirect rule for `docs.buywhere.ai` so the subdomain resolves directly to the nginx server.

### Priority 2 — Landing page hero (Design)

Replace the default Docusaurus root with a custom landing page. Design direction:

```
┌──────────────────────────────────────────────────────────┐
│  BUYWHERE API                        [Docs] [Pricing] [Get Key] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  The product catalog API for AI agents                   │
│                                                          │
│  Search 5M+ products across 40+ retailers.               │
│  Get an API key in 3 seconds — no signup.               │
│                                                          │
│  ┌──────────────────────────────────────┐               │
│  │ $ curl -X POST api.buywhere.ai/v1/   │ ← animated   │
│  │   auth/register -d '{"agent_name"}' │   terminal   │
│  │ { "api_key": "bw_xxxxx" }           │               │
│  └──────────────────────────────────────┘               │
│                                                          │
│  [Get API Key →]        [View Docs →]                   │
│                                                          │
│  ─────────────────────────────────────────               │
│  5M+ products  ·  40+ retailers  ·  7 countries        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Design decisions:
- **Terminal hero** — live curl example showing instant key registration. Animated typing effect.
- **Color** — same `#2563eb` blue, consistent with main site
- **Dark mode** — Docusaurus handles automatically
- **Social card** — verify `buywhere-social-card.png` renders correctly at 1200×630px

### Priority 3 — Footer polish

Add community links:
```ts
{ label: 'GitHub', href: 'https://github.com/buywhere/buywhere-api' },
{ label: 'Discord', href: 'https://discord.gg/buywhere' },  // or placeholder
```

---

## Verification Checklist

- [ ] `deploy-docs.yml` dispatch succeeds and `/var/www/docs.buywhere.ai/` is populated
- [ ] `curl https://docs.buywhere.ai/` returns HTTP 200 with Docusaurus HTML
- [ ] Cloudflare redirect for `docs.buywhere.ai` is removed
- [ ] Custom landing page renders on `/` (not default docs shell)
- [ ] `buywhere-social-card.png` renders correctly in Twitter card validator
- [ ] Dark mode toggle works correctly
- [ ] Mobile viewport: hamburger nav works, code blocks scroll horizontally
- [ ] `npm run build` completes without warnings (Docusaurus v3.10.1 → v3.10.2 upgrade available)
