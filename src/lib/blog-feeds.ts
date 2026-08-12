import { getAllBlogPosts, type BlogPost } from "@/lib/blog";
import { toSiteUrl } from "@/lib/site-url";

const FEED_TITLE = "BuyWhere Blog";
const FEED_DESCRIPTION =
  "Buying guides, price-comparison reviews, launch updates, and developer tutorials for commerce AI agents.";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function feedDate(value: string): string {
  return new Date(value).toUTCString();
}

function atomDate(value: string): string {
  return new Date(value).toISOString();
}

function postUrl(post: BlogPost): string {
  return post.canonicalUrl ?? toSiteUrl(`/blog/${post.slug}`);
}

function postsUpdatedAt(posts: BlogPost[]): string {
  const latest = posts[0]?.lastUpdatedAt ?? posts[0]?.publishedAt;
  return atomDate(latest ?? "2026-06-01");
}

export function renderBlogRssFeed(posts = getAllBlogPosts()): string {
  const items = posts
    .map((post) => {
      const url = postUrl(post);
      const categories = post.tags
        .map((tag) => `      <category>${xmlEscape(tag)}</category>`)
        .join("\n");

      return `    <item>
      <title>${xmlEscape(post.title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <description>${xmlEscape(post.description)}</description>
      <author>${xmlEscape(post.author)}</author>
      <pubDate>${feedDate(post.publishedAt)}</pubDate>${categories ? `\n${categories}` : ""}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(FEED_TITLE)}</title>
    <link>${xmlEscape(toSiteUrl("/blog"))}</link>
    <description>${xmlEscape(FEED_DESCRIPTION)}</description>
    <language>en-US</language>
    <lastBuildDate>${feedDate(posts[0]?.lastUpdatedAt ?? posts[0]?.publishedAt ?? "2026-06-01")}</lastBuildDate>
    <atom:link href="${xmlEscape(toSiteUrl("/blog/rss.xml"))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}

export function renderBlogAtomFeed(posts = getAllBlogPosts()): string {
  const entries = posts
    .map((post) => {
      const url = postUrl(post);
      const categories = post.tags
        .map((tag) => `    <category term="${xmlEscape(tag)}" />`)
        .join("\n");

      return `  <entry>
    <title>${xmlEscape(post.title)}</title>
    <link href="${xmlEscape(url)}" />
    <id>${xmlEscape(url)}</id>
    <updated>${atomDate(post.lastUpdatedAt ?? post.publishedAt)}</updated>
    <published>${atomDate(post.publishedAt)}</published>
    <author><name>${xmlEscape(post.author)}</name></author>
    <summary>${xmlEscape(post.description)}</summary>${categories ? `\n${categories}` : ""}
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(FEED_TITLE)}</title>
  <subtitle>${xmlEscape(FEED_DESCRIPTION)}</subtitle>
  <link href="${xmlEscape(toSiteUrl("/blog"))}" />
  <link href="${xmlEscape(toSiteUrl("/blog/feed.xml"))}" rel="self" type="application/atom+xml" />
  <id>${xmlEscape(toSiteUrl("/blog"))}</id>
  <updated>${postsUpdatedAt(posts)}</updated>
${entries}
</feed>`;
}

export function buildFeedResponse(xml: string, contentType: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Cache-Control": "s-maxage=300, stale-while-revalidate=86400",
    },
  });
}
