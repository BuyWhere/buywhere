const NOINDEX_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "public, max-age=3600",
};

const unsupportedBody = (route: string) => `${route} is not configured for BuyWhere.\n`;

export function unsupportedMetadataRoute(route: string) {
  return new Response(unsupportedBody(route), {
    status: 404,
    headers: {
      ...NOINDEX_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function textMetadataRoute(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export function jsonMetadataRoute(body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export function xmlMetadataRoute(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export const SECURITY_TXT = `Contact: mailto:security@buywhere.ai
Preferred-Languages: en
Canonical: https://buywhere.ai/.well-known/security.txt
`;

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [],
  },
  webcredentials: {
    apps: [],
  },
};

export const SITE_WEB_MANIFEST = {
  name: "BuyWhere",
  short_name: "BuyWhere",
  description: "Product Discovery Infrastructure for AI-Powered Shopping",
  start_url: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#4F46E5",
  icons: [
    {
      src: "/favicon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
    {
      src: "/apple-touch-icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
  apple_mobile_web_app_capable: "yes",
  apple_mobile_web_app_status_bar_style: "default",
  apple_mobile_web_app_title: "BuyWhere",
};

export const BROWSERCONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <TileColor>#4F46E5</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`;
