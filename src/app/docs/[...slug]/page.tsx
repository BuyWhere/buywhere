import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { toSiteUrl } from "@/lib/site-url";
import Schema from "@/components/Schema";

const docsDirectory = path.join(process.cwd(), "docs");

type DocsFrontmatter = {
  title?: string;
  description?: string;
  version?: string;
  lastUpdated?: string;
  author?: string;
  status?: string;
  public?: boolean;
};

type DocRouteParams = {
  params: Promise<{
    slug: string[];
  }>;
};

type DocRecord = {
  slug: string;
  title: string;
  description: string;
  version: string;
  lastUpdated: string;
  author: string;
  status: string;
  isPublic: boolean;
  body: string;
};

function getMarkdownFiles(directory: string, baseDirectory = directory): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return getMarkdownFiles(fullPath, baseDirectory);
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      return [];
    }

    return path.relative(baseDirectory, fullPath);
  });
}

function parseDocs(relativePath: string) {
  const fullPath = path.join(docsDirectory, relativePath);
  const source = fs.readFileSync(fullPath, "utf8");

  let data: matter.GrayMatterFile<string>["data"];
  let content: string;

  try {
    const parsed = matter(source);
    data = parsed.data;
    content = parsed.content;
  } catch {
    return null;
  }

  const frontmatter = data as DocsFrontmatter;
  const slug = relativePath.replace(/\.md$/, "").split(path.sep).join("/");
  const fallbackTitle = path.basename(relativePath, ".md");

  return {
    slug,
    title: frontmatter.title || fallbackTitle,
    description: frontmatter.description || "",
    version: frontmatter.version || "",
    lastUpdated: frontmatter.lastUpdated || "",
    author: frontmatter.author || "",
    status: frontmatter.status || "",
    isPublic: frontmatter.public === true,
    body: content.trim(),
  };
}

function isPublicDoc(doc: DocRecord | null): doc is DocRecord {
  return doc !== null && doc.isPublic;
}

function getAllDocs(): DocRecord[] {
  return getMarkdownFiles(docsDirectory)
    .map(parseDocs)
    .filter(isPublicDoc);
}

function getDocBySlug(slugParts: string[]) {
  const slug = slugParts.join("/");

  if (!slug || slugParts.some((part) => part === ".." || part.includes(path.sep))) {
    return null;
  }

  const docs = getAllDocs();
  return docs.find((doc) => doc.slug === slug);
}

function buildDocSchema(doc: DocRecord) {
  const path = `/docs/${doc.slug}`;
  const isGuide = doc.slug.startsWith("guides/");
  const isApiReference = doc.slug.startsWith("api-reference/");
  const dateModified = doc.lastUpdated || "2026-08-14";
  const article = {
    "@context": "https://schema.org",
    "@type": isApiReference ? ["TechArticle", "APIReference"] : isGuide ? ["TechArticle", "HowTo"] : "TechArticle",
    headline: doc.title,
    name: doc.title,
    description: doc.description,
    url: toSiteUrl(path),
    dateModified,
    author: {
      "@type": "Organization",
      name: doc.author || "BuyWhere",
      url: toSiteUrl("/"),
    },
    publisher: {
      "@type": "Organization",
      name: "BuyWhere",
      url: toSiteUrl("/"),
      logo: {
        "@type": "ImageObject",
        url: toSiteUrl("/og-image.png"),
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": toSiteUrl(path),
    },
    image: [toSiteUrl("/og-image.png")],
  };

  return article;
}

// Only the published docs are valid slugs; anything else 404s at the routing layer
export const dynamicParams = false;

export async function generateStaticParams() {
  const docs = getAllDocs();
  return docs.map((doc) => ({ slug: doc.slug.split("/") }));
}

export async function generateMetadata({ params }: DocRouteParams): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDocBySlug(slug);

  if (!doc) {
    return {
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {
    title: doc.title,
    description: doc.description,
    alternates: {
      canonical: toSiteUrl(`/docs/${doc.slug}`),
    },
    openGraph: {
      title: doc.title,
      description: doc.description,
      type: "website",
      url: toSiteUrl(`/docs/${doc.slug}`),
      siteName: "BuyWhere Documentation",
      images: [
        {
          url: toSiteUrl("/og-image.png"),
          width: 1200,
          height: 630,
          alt: doc.title,
        },
      ],
    },
    robots: {
      index: true,
      follow: true,
    },
    twitter: {
      card: "summary_large_image",
      title: doc.title,
      description: doc.description,
      images: [toSiteUrl("/og-image.png")],
    },
  };
}

export default async function DocPage({ params }: DocRouteParams) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  const allDocs = getAllDocs();

  if (!doc) {
    notFound();
  }

  const formatDate = (dateString: string) => {
    if (!dateString) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(dateString));
    } catch {
      return dateString;
    }
  };

  const schema = buildDocSchema(doc);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Schema data={schema} />
      <Nav />

      <main id="main-content" className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-16">
            <Link href="/docs" className="mb-6 inline-flex text-sm font-medium text-indigo-600">
              ← Back to documentation
            </Link>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              {doc.title}
            </h1>
            <div className="mb-4 flex flex-wrap gap-2 text-sm text-slate-500">
              {doc.version && (
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                  v{doc.version}
                </span>
              )}
              {doc.lastUpdated && (
                <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  Updated: {formatDate(doc.lastUpdated)}
                </span>
              )}
              {doc.status && (
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                  {doc.status}
                </span>
              )}
              {doc.author && (
                <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  By: {doc.author}
                </span>
              )}
            </div>
            {doc.description && (
              <p className="max-w-3xl text-lg leading-8 text-slate-600">{doc.description}</p>
            )}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <div className="blog-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <div className="mt-10 text-3xl font-bold tracking-tight text-slate-900 first:mt-0">
                      {children}
                    </div>
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
                    href && !href.startsWith("/BUY/") && !href.startsWith("/PAP/") && !href.startsWith("/home/") ? (
                      <a
                        href={href}
                        className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4"
                      >
                        {children}
                      </a>
                    ) : (
                      <span>{children}</span>
                    )
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
                {doc.body}
              </ReactMarkdown>
            </div>
          </article>

          <aside className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600">
                Documentation
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">
                Browse all docs
              </h2>
              <div className="mt-5 flex flex-col gap-2">
                {allDocs
                  .filter((d) => d.slug !== doc.slug)
                  .map((d) => (
                    <Link
                      key={d.slug}
                      href={`/docs/${d.slug}`}
                      className="flex items-center justify-between px-4 py-2 text-sm font-medium rounded hover:bg-slate-50 transition-colors"
                    >
                      <span>{d.title}</span>
                      <span className="text-slate-400">→</span>
                    </Link>
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
