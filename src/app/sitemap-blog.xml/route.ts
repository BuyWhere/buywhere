import { buildSitemapResponse, renderUrlSet, type SitemapUrlEntry, SITEMAP_BASE_URL } from "@/lib/sitemaps";
import { getAllBlogPosts } from "@/lib/blog";

export const dynamic = "force-static";

export function GET(): Response {
  const posts = getAllBlogPosts();
  const now = new Date();

  const entries: SitemapUrlEntry[] = posts.map((post) => ({
    url: `${SITEMAP_BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return buildSitemapResponse(renderUrlSet(entries));
}
