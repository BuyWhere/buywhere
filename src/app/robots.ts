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
    sitemap: "https://buywhere.ai/sitemap.xml",
  };
}