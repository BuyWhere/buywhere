import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getAllBlogPosts, getBlogPostBySlug } from "@/lib/blog";

type PageProps = {
  params: { slug: string };
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

export function generateStaticParams() {
  return getAllBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const post = getBlogPostBySlug(params.slug);

  if (!post) {
    return {};
  }

  const canonical = post.canonicalUrl ?? `https://buywhere.ai/blog/${post.slug}`;

  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url: canonical,
      publishedTime: post.publishedAt,
      authors: [post.author],
    },
  };
}

export default function BlogPostPage({ params }: PageProps) {
  const post = getBlogPostBySlug(params.slug);
  const relatedPosts = getAllBlogPosts()
    .filter((candidate) => candidate.slug !== params.slug)
    .slice(0, 3);

  if (!post) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <main className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-16">
            <Link href="/blog" className="mb-6 inline-flex text-sm font-medium text-indigo-600">
              ← Back to blog
            </Link>
            <div className="mb-5 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              {post.title}
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">{post.description}</p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-500">
              <span>{post.author}</span>
              <span>•</span>
              <span>{formatDate(post.publishedAt)}</span>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <div className="blog-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="mt-10 text-3xl font-bold tracking-tight text-slate-900 first:mt-0">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mt-10 text-2xl font-semibold tracking-tight text-slate-900">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mt-8 text-xl font-semibold text-slate-900">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="mt-5 text-base leading-8 text-slate-700">{children}</p>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4"
                    >
                      {children}
                    </a>
                  ),
                  ul: ({ children }) => (
                    <ul className="mt-5 list-disc space-y-3 pl-6 text-base leading-8 text-slate-700">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mt-5 list-decimal space-y-3 pl-6 text-base leading-8 text-slate-700">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li>{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="mt-6 rounded-r-2xl border-l-4 border-indigo-500 bg-indigo-50/70 px-5 py-4 text-slate-700">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="my-8 border-slate-200" />,
                  code: ({ className, children }) => (
                    <code
                      className={
                        className
                          ? `${className} font-mono text-sm text-slate-100`
                          : "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.95em] text-slate-800"
                      }
                    >
                      {children}
                    </code>
                  ),
                  pre: ({ children }) => (
                    <pre className="mt-6 overflow-x-auto rounded-2xl bg-slate-950 p-5 text-sm leading-7 text-slate-100">
                      {children}
                    </pre>
                  ),
                  table: ({ children }) => (
                    <div className="mt-6 overflow-x-auto">
                      <table className="min-w-full border-collapse overflow-hidden rounded-2xl border border-slate-200 text-left text-sm">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => <thead className="bg-slate-100 text-slate-700">{children}</thead>,
                  tbody: ({ children }) => <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>,
                  th: ({ children }) => <th className="px-4 py-3 font-semibold">{children}</th>,
                  td: ({ children }) => <td className="px-4 py-3 align-top text-slate-600">{children}</td>,
                }}
              >
                {post.body}
              </ReactMarkdown>
            </div>
          </article>

          <aside className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600">
                Build with BuyWhere
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">
                Ship agent commerce without scraping
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Use BuyWhere to add live product search, category coverage, and merchant-aware
                recommendations to your app.
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <Link
                  href="/api-keys"
                  className="rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Get API key
                </Link>
                <Link
                  href="/quickstart"
                  className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-semibold text-slate-700"
                >
                  Read quickstart
                </Link>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">More from the blog</h2>
              <div className="mt-4 space-y-4">
                {relatedPosts.map((relatedPost) => (
                  <div key={relatedPost.slug} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      {formatDate(relatedPost.publishedAt)}
                    </p>
                    <Link
                      href={`/blog/${relatedPost.slug}`}
                      className="mt-2 block text-sm font-medium leading-6 text-slate-800 hover:text-indigo-700"
                    >
                      {relatedPost.title}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </main>

      <Footer />
    </div>
  );
}
