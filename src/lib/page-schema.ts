// Shared JSON-LD schema helpers for buywhere.ai
// Each page renders a structured-data block via Schema component so search engines
// and AI crawlers get a coherent entity view (Organization, WebSite, WebPage, etc).

import { toSiteUrl } from "@/lib/site-url";

export const ORGANIZATION_ID = "https://buywhere.ai/#organization";
export const WEBSITE_ID = "https://buywhere.ai/#website";

const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "BuyWhere",
  alternateName: "BuyWhere Pte. Ltd.",
  url: "https://buywhere.ai",
  logo: {
    "@type": "ImageObject",
    url: "https://buywhere.ai/logo.png",
    width: 512,
    height: 512,
  },
  image: "https://buywhere.ai/og-image.png",
  description:
    "BuyWhere is the MCP server and product catalog API that gives AI agents real-time product search, price comparison, and merchant handoff across Southeast Asia and the US.",
  foundingDate: "2024",
  areaServed: [
    { "@type": "Country", name: "Singapore" },
    { "@type": "Country", name: "United States" },
  ],
  sameAs: [
    "https://twitter.com/buywhere",
    "https://linkedin.com/company/buywhere",
    "https://github.com/BuyWhere",
  ],
};

const WEBSITE = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  url: "https://buywhere.ai",
  name: "BuyWhere",
  inLanguage: "en",
  publisher: { "@id": ORGANIZATION_ID },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://buywhere.ai/search?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export function baseGraph() {
  return [ORGANIZATION, WEBSITE];
}

export type WebPageInput = {
  path: string;
  name: string;
  description: string;
  inLanguage?: string;
  extraTypes?: object[];
  breadcrumb?: { name: string; path: string }[];
};

export function buildWebPageSchema(input: WebPageInput) {
  const url = toSiteUrl(input.path);
  const graph = [
    ...baseGraph(),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: input.name,
      description: input.description,
      inLanguage: input.inLanguage ?? "en-US",
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
      ...(input.breadcrumb && input.breadcrumb.length > 0
        ? {
            breadcrumb: {
              "@id": `${url}#breadcrumb`,
            },
          }
        : {}),
    },
    ...(input.extraTypes ?? []),
  ];

  if (input.breadcrumb && input.breadcrumb.length > 0) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: input.breadcrumb.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: toSiteUrl(crumb.path),
      })),
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export type SoftwareApplicationInput = {
  path: string;
  name: string;
  description: string;
  applicationCategory?: string;
  operatingSystem?: string;
  offers?: { price: string; priceCurrency: string }[];
  // BUY-69732: optional breadcrumb rendered as a BreadcrumbList node in the
  // same @graph, mirroring buildWebPageSchema's `breadcrumb` input.
  breadcrumb?: { name: string; path: string }[];
};

export function buildSoftwareApplicationSchema(input: SoftwareApplicationInput) {
  const url = toSiteUrl(input.path);
  const graph: object[] = [
    ...baseGraph(),
    {
      "@type": "SoftwareApplication",
      "@id": `${url}#software`,
      name: input.name,
      url,
      description: input.description,
      applicationCategory: input.applicationCategory ?? "DeveloperApplication",
      operatingSystem: input.operatingSystem ?? "Any",
      publisher: { "@id": ORGANIZATION_ID },
      offers: input.offers ?? [
        { price: "0", priceCurrency: "USD" },
        { price: "29", priceCurrency: "USD" },
        { price: "99", priceCurrency: "USD" },
      ],
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: input.name,
      description: input.description,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
      ...(input.breadcrumb && input.breadcrumb.length > 0
        ? {
            breadcrumb: {
              "@id": `${url}#breadcrumb`,
            },
          }
        : {}),
    },
  ];
  if (input.breadcrumb && input.breadcrumb.length > 0) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: input.breadcrumb.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: toSiteUrl(crumb.path),
      })),
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export type ServiceInput = {
  path: string;
  name: string;
  description: string;
  serviceType: string;
  areaServed?: string[];
};

export function buildServiceSchema(input: ServiceInput) {
  const url = toSiteUrl(input.path);
  const graph = [
    ...baseGraph(),
    {
      "@type": "Service",
      "@id": `${url}#service`,
      name: input.name,
      url,
      description: input.description,
      serviceType: input.serviceType,
      provider: { "@id": ORGANIZATION_ID },
      areaServed: (input.areaServed ?? ["Singapore", "United States"]).map((name) => ({
        "@type": "Country",
        name,
      })),
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: input.name,
      description: input.description,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
    },
  ];
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export type SearchPageInput = {
  path: string;
  name: string;
  description: string;
};

export function buildSearchPageSchema(input: SearchPageInput) {
  const url = toSiteUrl(input.path);
  const graph = [
    ...baseGraph(),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: input.name,
      description: input.description,
      inLanguage: "en-US",
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://buywhere.ai/search?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
  ];
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export type CollectionPageInput = {
  path: string;
  name: string;
  description: string;
  // BUY-69732: optional breadcrumb rendered as a BreadcrumbList node in the
  // same @graph, mirroring buildWebPageSchema's `breadcrumb` input.
  breadcrumb?: { name: string; path: string }[];
};

export function buildCollectionPageSchema(input: CollectionPageInput) {
  const url = toSiteUrl(input.path);
  const graph: object[] = [
    ...baseGraph(),
    {
      "@type": "CollectionPage",
      "@id": `${url}#webpage`,
      url,
      name: input.name,
      description: input.description,
      inLanguage: "en-US",
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
      publisher: { "@id": ORGANIZATION_ID },
      ...(input.breadcrumb && input.breadcrumb.length > 0
        ? {
            breadcrumb: {
              "@id": `${url}#breadcrumb`,
            },
          }
        : {}),
    },
  ];
  if (input.breadcrumb && input.breadcrumb.length > 0) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: input.breadcrumb.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: toSiteUrl(crumb.path),
      })),
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
