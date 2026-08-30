import { buildBlogRssResponse } from "@/lib/feed";

// BUY-68406: /blog/feed.xml is a common feed-discovery alias. Serve the same
// RSS 2.0 document as /blog/rss.xml so feed readers that probe either path get
// a machine-readable XML response instead of the homepage HTML 404 shell.
export function GET(): Response {
  return buildBlogRssResponse();
}
