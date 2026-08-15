import Link from "next/link";
import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

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

// Self-referential, non-trailing-slash canonical on /docs.
// BUY-70024: the page body now renders a sidebar with all docs links so SSR
// link extraction finds the same doc links as child docs pages do.
export function generateMetadata(): Metadata {
  return {
    title: "Documentation — BuyWhere",
    description:
      "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.",
    alternates: {
      canonical: toSiteUrl("/docs"),
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: "Documentation — BuyWhere",
      description:
        "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.",
      url: toSiteUrl("/docs"),
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "BuyWhere developer documentation",
        },
      ],
    },
  };
}

export default function DocsPage() {
  const allDocs = getAllDocs();
  const schema = buildWebPageSchema({
    path: "/docs",
    name: "Documentation | BuyWhere",
    description:
      "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Documentation", path: "/docs" },
    ],
  });

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Schema data={schema} />
      <Nav />

      <main id="main-content" className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-16">
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Documentation
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">
              Everything you need to integrate, build, and scale with BuyWhere. From
              quickstart guides to API references and integration tutorials.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900 mb-4">Getting Started</h2>
                <p className="text-base leading-8 text-slate-700">
                  New to BuyWhere? Start with our{" "}
                  <Link href="/docs/getting-started" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    getting started guide
                  </Link>{" "}
                  to learn the basics, or jump straight to{" "}
                  <Link href="/docs/authentication" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    authentication
                  </Link>{" "}
                  to start making API calls.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-semibold text-slate-900 mb-4">API Reference</h2>
                <p className="text-base leading-8 text-slate-700">
                  Explore our complete API for{" "}
                  <Link href="/docs/api-reference/search" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    product search
                  </Link>,{" "}
                  <Link href="/docs/api-reference/categories" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    category browsing
                  </Link>,{" "}
                  <Link href="/docs/api-reference/deals" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    deals
                  </Link>, and more in the{" "}
                  <Link href="/docs/api-reference/search" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    API reference section
                  </Link>.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-semibold text-slate-900 mb-4">Integrations</h2>
                <p className="text-base leading-8 text-slate-700">
                  Connect BuyWhere with your workflow using our{" "}
                  <Link href="/docs/guides/mcp-integration" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    MCP server integration
                  </Link>{" "}
                  or the{" "}
                  <Link href="/docs/guides/mastra-integration" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                    Mastra AI integration
                  </Link>.
                </p>
              </div>
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
                {allDocs.map((d) => (
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
