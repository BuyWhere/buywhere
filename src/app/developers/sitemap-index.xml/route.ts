// Proxy to root sitemap-index.xml for /developers/sitemap-index.xml route.
// Developer/agent crawlers probe this legacy path as a sitemap-index entry point,
// so keep it as a semantic alias of the canonical sitemap index.
export { GET } from "@/app/sitemap-index.xml/route";
export { dynamic, revalidate, runtime } from "@/app/sitemap-index.xml/route";
