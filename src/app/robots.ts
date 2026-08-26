import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/login",
          "/home/",
          "/PAP/",
          "/BUY/",
          "/v1/",
          "/v2/",
          "/api/",
          "/api-reference/",
          "/search",
          "/r/",
        ],
      },
      {
        userAgent: "GPTBot",
        allow: "/",
      },
      {
        userAgent: "ClaudeBot",
        allow: "/",
      },
      {
        userAgent: "PerplexityBot",
        allow: "/",
      },
      {
        userAgent: "anthropic-ai",
        allow: "/",
      },
      {
        userAgent: "Google-Extended",
        allow: "/",
      },
      {
        userAgent: "CCBot",
        allow: "/",
      },
    ],
    // Declare every sub-sitemap individually (BUY-65147). Some crawlers
    // (Bing, Applebot) only pick up Sitemap directives from robots.txt;
    // they ignore a single sitemap.xml pointer to an index. Listing
    // each sub-sitemap here also keeps coverage if the index is
    // temporarily stale at a CDN edge.
    sitemap: [
      "https://buywhere.ai/sitemap.xml",
      "https://buywhere.ai/sitemap-pages.xml",
      "https://buywhere.ai/sitemap-products.xml",
      "https://buywhere.ai/sitemap-categories.xml",
      "https://buywhere.ai/sitemap-compare.xml",
    ],
  };
}