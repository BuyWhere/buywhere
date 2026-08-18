import { buildSitemapResponse, renderUrlSet, type SitemapUrlEntry } from "@/lib/sitemaps";
import { getAllBlogPosts } from "@/lib/blog";
import { toSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export function GET(): Response {
  const blogPosts = getAllBlogPosts();

  const entries: SitemapUrlEntry[] = blogPosts.map((post) => ({
    url: toSiteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const xml = renderUrlSet(entries);
  return buildSitemapResponse(xml);
}
