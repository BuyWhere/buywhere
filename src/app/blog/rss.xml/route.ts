import { buildBlogRssResponse } from "@/lib/feed";

// BUY-68406: canonical blog feed. /blog/rss.xml previously matched the
// /blog/[slug] dynamic page and rendered a homepage HTML 404 shell; this route
// handler serves a real RSS 2.0 document with application/rss+xml content type.
export function GET(): Response {
  return buildBlogRssResponse();
}
