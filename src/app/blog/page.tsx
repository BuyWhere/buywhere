import Link from "next/link";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import { getAllBlogPosts } from "@/lib/blog";
import { buildPageMetadata } from "@/lib/page-metadata";
import { buildWebPageSchema } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

const BLOG_TITLE = "BuyWhere Blog — Buying Guides & Price-Comparison Reviews";
const BLOG_DESCRIPTION =
  "Read buying guides, price-comparison reviews, launch updates, and developer tutorials for commerce AI agents.";

// BUY-68406: advertise the blog RSS feed via <link rel="alternate"
// type="application/rss+xml"> so feed readers and agent-discovery consumers can
// autodiscover the canonical feed URL from /blog. Layered on top of the shared
// page-metadata helper to add the feed alternate without changing every caller.
export const metadata: Metadata = {
  ...buildPageMetadata({
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    path: "/blog",
  }),
  alternates: {
    canonical: toSiteUrl("/blog"),
    types: {
      "application/rss+xml": [
        { url: toSiteUrl("/blog/rss.xml"), title: BLOG_TITLE },
      ],
    },
  },
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

export default function BlogIndexPage() {
  const posts = getAllBlogPosts();
  const featuredPost = posts[0];
  const remainingPosts = posts.slice(1);
  const blogUrl = toSiteUrl("/blog");
  const jsonLd = buildWebPageSchema({
    path: "/blog",
    name: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog" },
    ],
    extraTypes: [
      {
        "@type": ["Blog", "CollectionPage"],
        "@id": `${blogUrl}#blog`,
        url: blogUrl,
        name: BLOG_TITLE,
        description: BLOG_DESCRIPTION,
        inLanguage: "en-US",
        mainEntityOfPage: { "@id": `${blogUrl}#webpage` },
        blogPost: posts.slice(0, 10).map((post) => ({
          "@type": "BlogPosting",
          "@id": toSiteUrl(`/blog/${post.slug}`),
          url: toSiteUrl(`/blog/${post.slug}`),
          headline: post.title,
          description: post.description,
          datePublished: post.publishedAt,
          author: { "@type": "Person", name: post.author },
          mainEntityOfPage: toSiteUrl(`/blog/${post.slug}`),
        })),
      },
      {
        "@type": "ItemList",
        "@id": `${blogUrl}#itemlist`,
        name: `${BLOG_TITLE} — Recent Posts`,
        itemListElement: posts.slice(0, 10).map((post, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: toSiteUrl(`/blog/${post.slug}`),
          name: post.title,
        })),
      },
    ],
  });

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Schema data={jsonLd} />
      <Nav />

      <main id="main-content" className="flex-1">
        <section className="border-b border-indigo-100 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_35%),linear-gradient(180deg,#eef2ff_0%,#f8fafc_100%)]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-indigo-600">
                BuyWhere Blog
              </p>
              <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                Product catalog strategy and build guides for AI agents
              </h1>
              <p className="text-lg leading-8 text-slate-600">
                Tutorials for agent developers, launch updates, and SEO content focused on
                Singapore commerce, neutral catalog infrastructure, and real-world product search.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
          {featuredPost ? (
            <div className="mb-10 rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
              <p className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-indigo-600">
                Latest Post
              </p>
              <h2 className="mb-4 text-3xl font-bold text-slate-900">
                <Link href={`/blog/${featuredPost.slug}`} className="hover:text-indigo-700">
                  {featuredPost.title}
                </Link>
              </h2>
              <p className="mb-6 max-w-3xl text-base leading-7 text-slate-600">
                {featuredPost.description}
              </p>
              <div className="mb-6 flex flex-wrap gap-3 text-sm text-slate-500">
                <span>{formatDate(featuredPost.publishedAt)}</span>
                <span>•</span>
                <span>{featuredPost.author}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {featuredPost.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {remainingPosts.map((post) => (
              <article
                key={post.slug}
                className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition-transform hover:-translate-y-1"
              >
                <div className="mb-4 flex flex-wrap gap-2">
                  {post.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-900">
                  <Link href={`/blog/${post.slug}`} className="hover:text-indigo-700">
                    {post.title}
                  </Link>
                </h2>
                <p className="mb-6 flex-1 text-sm leading-7 text-slate-600">{post.description}</p>
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>{formatDate(post.publishedAt)}</span>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="font-medium text-indigo-600"
                    aria-label={`Read article: ${post.title}`}
                  >
                    Read article →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
