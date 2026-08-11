import { getAllBlogPosts, type BlogPost } from "@/lib/blog";

// BUY-68406: blog/feed syndication endpoints.
//
// Before this change, /blog/rss.xml and /blog/feed.xml fell through to the
// /blog/[slug] dynamic route (slug = "rss.xml"), hit notFound(), and rendered
// the homepage-styled HTML 404 shell with homepage og/twitter metadata. Feed
// readers, crawlers, and agent-discovery consumers got a 200 HTML page instead
// of machine-readable XML. These helpers build a real RSS 2.0 document from the
// same content/blog markdown source the blog index and sitemap already use.

const SITE_ORIGIN = "https://buywhere.ai";
const FEED_TITLE = "BuyWhere Blog — Buying Guides & Price-Comparison Reviews";
const FEED_DESCRIPTION =
  "Buying guides, price-comparison reviews, launch updates, and developer tutorials for commerce AI agents.";
const MAX_FEED_ITEMS = 20;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822Date(dateStr: string): string {
  // publishedAt is a YYYY-MM-DD string (see src/lib/blog.ts). Build the date in
  // UTC to avoid any host-locale offset leaking into the pubDate.
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) {
    return dateStr;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toUTCString();
}

function renderItem(post: BlogPost): string {
  const link = `${SITE_ORIGIN}/blog/${post.slug}`;
  const guid = `${SITE_ORIGIN}/blog/${post.slug}`;
  const pubDate = toRfc822Date(post.lastUpdatedAt ?? post.publishedAt);
  // Description doubles as a plain-text excerpt; strip any markup the
  // frontmatter might carry so the feed stays valid RSS 2.0.
  const description = post.description.replace(/\s+/g, " ").trim();

  return [
    "    <item>",
    `      <title>${escapeXml(post.title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(guid)}</guid>`,
    `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
    `      <description>${escapeXml(description)}</description>`,
    `      <dc:creator>${escapeXml(post.author)}</dc:creator>`,
    ...post.tags.slice(0, 8).map(
      (tag) => `      <category>${escapeXml(tag)}</category>`,
    ),
    "    </item>",
  ].join("\n");
}

/**
 * Renders the BuyWhere blog as an RSS 2.0 document. Returns a minimal but valid
 * feed even when no blog posts are available (e.g. content dir absent at build
 * time) so the route never falls back to an HTML shell.
 */
export function renderBlogRssFeed(): string {
  const posts = getAllBlogPosts().slice(0, MAX_FEED_ITEMS);
  const lastBuildDate =
    posts.length > 0
      ? toRfc822Date(posts[0].lastUpdatedAt ?? posts[0].publishedAt)
      : new Date(Date.UTC(1970, 0, 1)).toUTCString();

  const items = posts.length > 0 ? posts.map(renderItem).join("\n") : "";

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `  <channel>`,
    `    <title>${escapeXml(FEED_TITLE)}</title>`,
    `    <link>${escapeXml(SITE_ORIGIN + "/blog")}</link>`,
    `    <description>${escapeXml(FEED_DESCRIPTION)}</description>`,
    `    <language>en-us</language>`,
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(SITE_ORIGIN + "/blog/rss.xml")}" rel="self" type="application/rss+xml" />`,
    items,
    `  </channel>`,
    `</rss>`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Builds the Response for the blog RSS feed. Content type is
 * application/rss+xml (the value feed readers expect) and the body is marked
 * noindex so the feed itself never competes with /blog in search results.
 */
export function buildBlogRssResponse(): Response {
  const xml = renderBlogRssFeed();
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
