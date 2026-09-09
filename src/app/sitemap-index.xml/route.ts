import { GET as getSitemapIndex } from "@/app/sitemap.xml/route";

// BUY-71502: restore the legacy canonical sitemap-index.xml URL as a
// byte-for-byte semantic alias of /sitemap.xml. Some validators and historical
// references still probe this filename, while robots.txt remains standardized
// on /sitemap.xml.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return getSitemapIndex();
}
