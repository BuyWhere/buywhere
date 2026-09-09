import { buildSitemapResponse, renderUrlSet, type SitemapUrlEntry } from "@/lib/sitemaps";
import { getAllBlogPosts } from "@/lib/blog";
import { toSiteUrl } from "@/lib/site-url";
import { getStoredPageLastmod } from "@/lib/page-content-hash";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// BUY-74905 (directive §5): prefer the persisted content-hash stamp over the
// raw frontmatter `publishedAt`. Without this override the blog sitemap
// would carry a stale date and disagree with the visible "Last updated
// <date>" stamp on each post (directive §5 says they must move together).
export async function GET(): Promise<Response> {
  const blogPosts = getAllBlogPosts();
  const entries: SitemapUrlEntry[] = await Promise.all(
    blogPosts.map(async (post) => {
      const url = toSiteUrl(`/blog/${post.slug}`);
      const stored = await getStoredPageLastmod(url);
      const lastmod = stored?.lastmod ?? new Date(post.publishedAt).toISOString();
      return {
        url,
        lastModified: lastmod,
        changeFrequency: "monthly" as const,
        priority: 0.8,
      };
    }),
  );

  const xml = renderUrlSet(entries);
  return buildSitemapResponse(xml);
}