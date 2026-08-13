import { buildBlogRssResponse } from "@/lib/feed";

// BUY-69024: serve /rss.xml as alias for /blog/rss.xml. Previously fell through
// to [seo-page] dynamic route, rendered homepage HTML 404 shell.
export function GET(): Response {
  return buildBlogRssResponse();
}
