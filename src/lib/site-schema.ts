// Shared JSON-LD schema graph for buywhere.ai core entities.
// BUY-13256: add Organization + WebSite (with SearchAction) +
// SoftwareApplication to the root layout so every page declares the
// brand, site search, and MCP product consistently for crawlers and
// answer engines.

export const SITE_URL = "https://buywhere.ai";
export const ORG_ID = `${SITE_URL}/#organization`;
export const SITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

export const organizationSchema = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: "BuyWhere",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [
    "https://github.com/BuyWhere",
    "https://github.com/BuyWhere/buywhere-mcp",
    "https://www.npmjs.com/package/@buywhere/mcp-server",
    "https://smithery.ai/servers/buywhere",
    "https://glama.ai/mcp/servers/BuyWhere/buywhere-mcp",
    "https://t.me/buywhere_bot",
  ],
  description:
    "BuyWhere is the MCP server and product catalog API that gives AI agents real-time product search, price comparison, and merchant handoff across Southeast Asia and the US.",
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "api@buywhere.ai",
    url: SITE_URL,
    availableLanguage: ["English"],
  },
};

export const websiteSchema = {
  "@type": "WebSite",
  "@id": SITE_ID,
  url: SITE_URL,
  name: "BuyWhere",
  publisher: { "@id": ORG_ID },
  inLanguage: "en",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export const softwareApplicationSchema = {
  "@type": "SoftwareApplication",
  "@id": SOFTWARE_ID,
  name: "BuyWhere MCP Server",
  applicationCategory: "DeveloperApplication",
  applicationSubCategory: "Model Context Protocol Server",
  operatingSystem: "Any",
  url: SITE_URL,
  description:
    "Model Context Protocol server for AI agents — search and compare products across Singapore, Southeast Asia, and US markets.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: { "@id": ORG_ID },
};

// Default graph for the root layout. Pages that already emit their own
// Organization / WebSite / SoftwareApplication (e.g. the homepage) can
// safely co-emit this graph because every entity uses a stable @id —
// search engines merge them by id, not by JSON-LD block.
export const siteSchemaGraph = {
  "@context": "https://schema.org",
  "@graph": [organizationSchema, websiteSchema, softwareApplicationSchema],
};
