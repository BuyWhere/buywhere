# BuyWhere Developer Portal

The official marketing site and developer portal for BuyWhere.

> **Note:** The `pages/` directory contains Jinja2 templates. Do NOT serve these directly.
> Always run `python3 build.py` first and serve from the `dist/` directory.

## Structure

```
portal/
├── assets/
│   ├── css/
│   │   ├── design-system.css    # Design tokens and base styles
│   │   └── price-widget.css     # Price comparison widget styles
│   └── js/
│       ├── main.js              # Core JavaScript functionality
│       ├── autocomplete.js      # Product search autocomplete
│       └── price-widget.js      # Embeddable price comparison widget
├── components/
│   └── product-card.html        # Reusable product card component
├── pages/
│   ├── index.html               # Homepage
│   ├── docs-api-reference.html  # API Reference documentation page
│   └── widget-demo.html         # Widget demo and integration guide
├── templates/
│   └── base.html                # Base HTML template
└── README.md                    # This file
```

## Design System

The design system is built with CSS custom properties (variables) defined in `assets/css/design-system.css`.

### Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bw-color-primary` | `#0066FF` | Primary brand color |
| `--bw-color-secondary` | `#10B981` | Secondary/action color |
| `--bw-color-accent` | `#F59E0B` | Accent/highlight color |
| `--bw-color-bg-primary` | `#FFFFFF` | Primary background |
| `--bw-color-bg-secondary` | `#F8FAFC` | Secondary background |
| `--bw-color-bg-dark` | `#0F172A` | Dark background |

### Typography

| Token | Value |
|-------|-------|
| `--bw-font-family-sans` | Inter, system fonts |
| `--bw-font-family-mono` | JetBrains Mono, monospace |

### Spacing Scale

Uses a consistent spacing scale: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `40px`, `48px`, `64px`, `80px`, `96px`

## Development

### Local Development

The portal is static HTML/CSS/JS. For local development:

1. Open `pages/index.html` directly in a browser
2. Or serve via any static file server:

```bash
npx serve portal
# or
python -m http.server 8000 -d portal
```

### Building

These HTML files can be used as-is or integrated into any static site generator (Next.js, Astro, etc.).

## Pages

### Homepage (`pages/index.html`)

The main marketing page featuring:
- Hero section with API example
- Feature cards
- Stats section
- Call to action

### API Reference (`pages/docs-api-reference.html`)

Documentation page with:
- Sidebar navigation
- Endpoint documentation
- Code examples
- Response schemas

## Components

### Product Card

Include in any page:

```html
<div class="product-card">
    <div class="product-card__image">
        <img src="{{ product.image }}" alt="{{ product.title }}">
    </div>
    <div class="product-card__content">
        <h3 class="product-card__title">
            <a href="/products/{{ product.id }}">{{ product.title }}</a>
        </h3>
        <div class="product-card__price">
            <span class="product-card__amount" data-price="{{ product.price }}">{{ product.currency }} {{ product.price }}</span>
        </div>
    </div>
</div>
```

### Price Comparison Widget

Embeddable widget for external sites to show BuyWhere prices. See [`pages/widget-demo.html`](pages/widget-demo.html) for live demos and integration guide.

#### Quick Start

```html
<!-- 1. Add the script -->
<script src="https://buywhere.io/widgets/price-widget.js"></script>

<!-- 2. Add container div -->
<div id="my-widget"></div>

<!-- 3. Initialize -->
<script>
BuyWhereWidget.create('my-widget', {
    query: 'Apple AirPods Pro',
    theme: 'light',
    layout: 'full'
});
</script>
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `query` | string | - | Product search query (use instead of ASIN) |
| `asin` | string | - | Amazon ASIN (use instead of query) |
| `theme` | string | `'light'` | `'light'` or `'dark'` |
| `layout` | string | `'full'` | `'full'` (all prices) or `'compact'` (cheapest only) |
| `apiKey` | string | - | BuyWhere API key (optional for demo) |
| `linkText` | string | `'View on BuyWhere'` | Link button text |
| `currency` | string | `'USD'` | Display currency |
| `apiBase` | string | `'https://api.buywhere.io'` | API base URL |
| `maxResults` | number | `3` | Max prices to fetch |

#### Data Attributes (No JS Required)

```html
<div id="my-widget"
     data-bw-widget-init
     data-bw-query="Apple AirPods Pro"
     data-bw-theme="light"
     data-bw-layout="full">
</div>
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Build System

The portal uses a Python build script to convert markdown docs to HTML and render Jinja2 templates.

```bash
# Build the portal (outputs to portal/dist/)
cd portal
python3 build.py

# Serve locally
python3 -m http.server 8080 --directory dist
```

The `dist/` directory contains pure static HTML, deployable to any CDN or static host.

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## TODO

- [x] Build system (build.py) — done
- [x] Doc pages (quickstart, api-reference, mcp-integration) — done
- [ ] Deploy to Vercel/CDN (needs Ops/DevOps)
- [ ] Homepage hero with live API search
- [ ] Mobile nav JS wiring
- [ ] Apply brand identity (BUY-2261) when available
- [ ] Dark mode toggle
