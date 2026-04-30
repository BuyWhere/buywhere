#!/usr/bin/env python3
"""
BuyWhere Developer Portal — Build Script
Renders Jinja2 templates and converts markdown docs to static HTML.
"""
import os
import re
import markdown
from jinja2 import Environment, FileSystemLoader, select_autoescape

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "pages")
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
DOCS_DIR = os.path.join(BASE_DIR, "..", "docs")
DIST_DIR = os.path.join(BASE_DIR, "dist")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")

MD = markdown.Markdown(extensions=["tables", "fenced_code", "toc"])

NAV_LINKS = [
    {"href": "/docs/quickstart", "label": "Quickstart"},
    {"href": "/docs/api-reference", "label": "API Reference"},
    {"href": "/playground", "label": "Playground"},
    {"href": "/docs/mcp-integration", "label": "MCP Integration"},
    {"href": "/docs/authentication", "label": "Authentication"},
]

CANONICAL_BASE = "https://buywhere.ai"

PAGE_CANONICALS = {
    "account-billing.html": f"{CANONICAL_BASE}/account/billing",
    "compare.html": f"{CANONICAL_BASE}/compare",
    "deals.html": f"{CANONICAL_BASE}/deals",
    "index.html": f"{CANONICAL_BASE}/",
    "about.html": f"{CANONICAL_BASE}/about",
    "blog.html": f"{CANONICAL_BASE}/blog",
    "blog-ai-agents-cheapest-products.html": f"{CANONICAL_BASE}/blog/ai-agents-cheapest-products",
    "blog-buywhere-vs-scraper.html": f"{CANONICAL_BASE}/blog/buywhere-vs-scraper",
    "blog-neutral-catalog-api.html": f"{CANONICAL_BASE}/blog/neutral-catalog-api",
    "blog-price-comparison-agent.html": f"{CANONICAL_BASE}/blog/price-comparison-agent",
    "blog-singapore-ecommerce-ai-agents.html": f"{CANONICAL_BASE}/blog/singapore-ecommerce-ai-agents",
    "blog-top-electronics-deals.html": f"{CANONICAL_BASE}/blog/top-electronics-deals",
    "careers.html": f"{CANONICAL_BASE}/careers",
    "contact.html": f"{CANONICAL_BASE}/contact",
    "docs-api-reference.html": f"{CANONICAL_BASE}/docs/api-reference",
    "login.html": f"{CANONICAL_BASE}/login",
    "pricing.html": f"{CANONICAL_BASE}/pricing",
    "privacy.html": f"{CANONICAL_BASE}/privacy",
    "register.html": f"{CANONICAL_BASE}/register",
    "terms.html": f"{CANONICAL_BASE}/terms",
    "us-signup.html": f"{CANONICAL_BASE}/us-signup",
    "widget-demo.html": f"{CANONICAL_BASE}/widget-demo",
}

def md_to_html(filename):
    path = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(path):
        return ""
    with open(path) as f:
        text = f.read()
    MD.reset()
    return MD.convert(text)

def make_jinja_env():
    return Environment(
        loader=FileSystemLoader([TEMPLATE_DIR, SRC_DIR]),
        autoescape=select_autoescape(["html", "xml"])
    )

def render_template(template_name, context=None):
    env = make_jinja_env()
    ctx = {
        "title": "BuyWhere",
        "description": "The agent-native product catalog API",
        "nav_links": NAV_LINKS,
        "robots": "",
        "sentry_enabled": bool(os.environ.get("SENTRY_DSN")),
    }
    if context:
        ctx.update(context)
    tmpl = env.get_template(template_name)
    return tmpl.render(**ctx)

def build_doc_page(src_template, out_filename, doc_md_file, page_title, page_description, canonical_url=None):
    doc_html = md_to_html(doc_md_file)
    content = render_template(src_template, {
        "title": page_title,
        "description": page_description,
        "doc_content": doc_html,
        "active_nav": page_title,
        "canonical_url": canonical_url or "",
    })
    out_path = os.path.join(DIST_DIR, out_filename)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        f.write(content)
    print(f"  Built: {out_filename}")

def copy_assets():
    import shutil
    dist_assets = os.path.join(DIST_DIR, "assets")
    if os.path.exists(dist_assets):
        shutil.rmtree(dist_assets)
    shutil.copytree(ASSETS_DIR, dist_assets)
    print(f"  Copied assets to {DIST_DIR}/assets")

def main():
    print("Building BuyWhere Developer Portal...")
    os.makedirs(DIST_DIR, exist_ok=True)

    copy_assets()

    print("Building doc pages...")
    build_doc_page("doc-layout.html", "docs/quickstart.html", "quickstart.md", "Quickstart", "Get started with the BuyWhere API in minutes", f"{CANONICAL_BASE}/docs/quickstart")
    build_doc_page("doc-layout.html", "docs/api-reference.html", "api-reference.md", "API Reference", "Full BuyWhere API reference", f"{CANONICAL_BASE}/docs/api-reference")
    build_doc_page("doc-layout.html", "docs/mcp-integration.html", "mcp-integration.md", "MCP Integration", "Connect BuyWhere to AI agents via MCP", f"{CANONICAL_BASE}/docs/mcp-integration")
    build_doc_page("doc-layout.html", "docs/authentication.html", "authentication.md", "Authentication", "API authentication guide", f"{CANONICAL_BASE}/docs/authentication")
    build_doc_page("doc-layout.html", "docs/errors.html", "errors.md", "Error Handling", "Error codes and handling", f"{CANONICAL_BASE}/docs/errors")

    print("Building static pages...")
    env = make_jinja_env()
    for page in os.listdir(SRC_DIR):
        if not page.endswith(".html"):
            continue
        src_path = os.path.join(SRC_DIR, page)
        if os.path.isfile(src_path):
            with open(src_path) as f:
                template_str = f.read()
            tmpl = env.from_string(template_str)
            page_context = {
                "title": "BuyWhere",
                "description": "The agent-native product catalog API",
                "canonical_url": PAGE_CANONICALS.get(page, ""),
                "robots": "",
                "sentry_enabled": bool(os.environ.get("SENTRY_DSN")),
            }
            content = tmpl.render(page_context)
            out_path = os.path.join(DIST_DIR, page)
            with open(out_path, "w") as f:
                f.write(content)
            print(f"  Built: {page}")

    print(f"\nPortal built to {DIST_DIR}/")
    print("Serve with: python3 -m http.server 8080 --directory dist")

if __name__ == "__main__":
    main()
