import { buildBlogRssResponse } from "@/lib/feed";

// BUY-69024: serve /feed.xml as alias for /blog/feed.xml. Previously fell through
// to [seo-page] dynamic route, rendered homepage HTML 404 shell.
export function GET(): Response {
  return buildBlogRssResponse();
}