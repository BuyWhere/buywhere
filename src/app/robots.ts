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
          "/docs/social/",
          "/docs/emails/",
          "/docs/content/",
          "/docs/challenges/",
          "/docs/blog/",
          "/docs/guides/",
          "/docs/tutorials/",
          "/docs/dashboard/",
          "/docs/bd/",
          "/docs/knowledge-base/",
          "/docs/pipelines/",
          "/docs/recipes/",
          "/docs/samples/",
          "/docs/analytics",
          "/docs/on-call-runbook",
          "/docs/staging-deploy-hardening-checklist",
          "/docs/product-hunt-launch-copy",
          "/docs/product-hunt-listing-BUY-3159",
          "/docs/singapore-merchant-value-prop",
          "/docs/sports-gear-landing-page",
          "/docs/tech-readiness-apr23",
          "/docs/agent-frameworks-research",
          "/docs/landing-page-copy",
          "/docs/BUY-",
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
      "https://buywhere.ai/sitemap-merchants.xml",
      "https://buywhere.ai/sitemap-categories.xml",
      "https://buywhere.ai/sitemap-compare.xml",
    ],
  };
}