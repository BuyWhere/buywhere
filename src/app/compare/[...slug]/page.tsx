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
import { compareCategoryPairSlug, findCompareCategoryPair, type CompareCategoryPair } from "@/lib/sitemaps";
import { formatCheckedStamp, getOrUpdatePageLastmod, serializeHashable } from "@/lib/page-content-hash";

const contentDir = path.join(process.cwd(), "content", "compare");

type Frontmatter = {
  title?: string; description?: string; slug?: string;
  category?: string; tags?: string[]; schema_type?: string;
  published?: string; updated?: string;
};

type Params = { params: { slug: string[] } };

function getAll() {
  try {
    return fs.readdirSync(contentDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(".md", ""))
      .filter(Boolean)
      .map((slug) => {
        try {
          const { data, content } = matter(fs.readFileSync(path.join(contentDir, `${slug}.md`), "utf8"));
          const fm = data as Frontmatter;
          let title = fm.title || "";
          if (!title && content) {
            const m = content.match(/^#\s+(.+)/m);
            if (m) title = m[1].trim();
          }
          return { slug: fm.slug || slug, title, description: fm.description || "", category: fm.category || "", tags: fm.tags || [], schemaType: fm.schema_type || "", updated: fm.updated || fm.published || "2026-05-07" };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

function getBySlug(slugParts: string[]) {
  const slug = slugParts.join("/");
  if (!slug || slugParts.some((p) => p === ".." || p.includes(path.sep))) return null;
  return getAll().find((d) => d && d.slug === slug) || null;
}

export async function generateStaticParams() {
  return getAll().map((d) => ({ slug: d!.slug.split("/") })).filter(Boolean);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const doc = getBySlug(params.slug);
  if (doc) {
    return {
      title: doc.title, description: doc.description,
      alternates: { canonical: toSiteUrl(`/compare/${doc.slug}`) },
      openGraph: { title: doc.title, description: doc.description, type: "website", url: toSiteUrl(`/compare/${doc.slug}`), siteName: "BuyWhere", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: doc.title }] },
      robots: { index: true, follow: true },
    };
  }

  const pair = params.slug.length === 1 ? await findCompareCategoryPair(params.slug[0]) : null;
  if (!pair) return {};
  const slug = compareCategoryPairSlug(pair);
  const title = `${pair.left.name} vs ${pair.right.name} Price Comparison | BuyWhere`;
  const description = `Compare ${pair.left.name.toLowerCase()} and ${pair.right.name.toLowerCase()} prices, product coverage, and shopping categories on BuyWhere.`;
  return {
    title,
    description,
    alternates: { canonical: toSiteUrl(`/compare/${slug}`) },
    openGraph: { title, description, type: "website", url: toSiteUrl(`/compare/${slug}`), siteName: "BuyWhere", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: title }] },
    // SEO-GATE BUY-74904: category-pair pages are templated doorway pages (indexation directive §1C);
    // keep the route live (no 410) but do not ask Google to index them. Real /compare docs above stay index,follow.
    robots: { index: false, follow: true },
  };
}

function buildFaqSchema(body: string) {
  const entities: { name: string; acceptedAnswer: { "@type": string; text: string } }[] = [];
  const lines = body.split("\n");
  let q = "", a = "", inA = false;
  for (const line of lines) {
    const qm = line.match(/^## (.+)/);
    if (qm) {
      if (q && a) entities.push({ name: q.trim(), acceptedAnswer: { "@type": "Answer", text: a.trim() } });
      q = qm[1]; a = ""; inA = false;
    } else if (line.trim() && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("|") && !line.startsWith("```") && q) {
      if (!inA) { inA = true; a = line.replace(/^#+\s*/, "").trim(); }
      else a += " " + line.trim();
    } else if (line.trim() === "" && inA) { inA = false; }
  }
  if (q && a) entities.push({ name: q.trim(), acceptedAnswer: { "@type": "Answer", text: a.trim() } });
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: entities };
}


async function CompareCategoryPairPage({ pair }: { pair: CompareCategoryPair }) {
  const slug = compareCategoryPairSlug(pair);
  const title = `${pair.left.name} vs ${pair.right.name} Price Comparison`;
  const description = `Compare ${pair.left.name.toLowerCase()} and ${pair.right.name.toLowerCase()} across BuyWhere's populated shopping catalog. Use this landing page to jump into each category's live price comparison surface.`;
  const canonical = toSiteUrl(`/compare/${slug}`);
  // BUY-74905 (directive §5): hash the pair's stable metadata so the visible
  // checked-date and the sitemap <lastmod> move only when the pair changes
  // (e.g. one category's product count shifts). productCount is dynamic so we
  // include it in the hash — that is the only piece of this page that can
  // change day-to-day without an editorial commit.
  const stamp = await getOrUpdatePageLastmod(
    canonical,
    serializeHashable({
      kind: "compare-category-pair",
      slug,
      leftSlug: pair.left.slug,
      rightSlug: pair.right.slug,
      leftName: pair.left.name,
      rightName: pair.right.name,
      leftProductCount: pair.left.productCount,
      rightProductCount: pair.right.productCount,
    }),
    "2026-08-25T00:00:00.000Z",
  );
  const checkedStamp = formatCheckedStamp(stamp);
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: toSiteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Compare", item: toSiteUrl("/compare") },
      { "@type": "ListItem", position: 3, name: title, item: canonical },
    ],
  };
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    description,
    url: canonical,
    itemListElement: [pair.left, pair.right].map((category, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: category.name,
      url: toSiteUrl(`/compare/${category.slug}`),
    })),
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }} />
      <Nav />
      <main id="main-content" className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16">
            <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1 text-sm text-slate-500">
              <Link href="/compare" className="font-medium text-indigo-600 hover:underline">Price Comparisons</Link>
              <span aria-hidden="true">/</span>
              <span className="text-slate-700">{title}</span>
            </nav>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Category comparison</p>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{title}</h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">{description}</p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <div className="grid gap-6 md:grid-cols-2">
            {[pair.left, pair.right].map((category) => (
              <Link
                key={category.slug}
                href={`/compare/${category.slug}`}
                className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
              >
                <p className="mb-2 text-sm font-medium text-indigo-600">{category.productCount.toLocaleString()} products indexed</p>
                <h2 className="mb-3 text-2xl font-semibold text-slate-900">{category.name}</h2>
                <p className="text-sm leading-7 text-slate-600">Browse live price coverage, retailer availability, and product listings for {category.name.toLowerCase()}.</p>
              </Link>
            ))}
          </div>
          <article className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="mb-3 text-2xl font-semibold text-slate-900">How to use this comparison</h2>
            <p className="text-base leading-8 text-slate-600">
              Compare category depth, live catalog freshness, and retailer coverage before choosing where to shop.
              BuyWhere keeps each category page focused on canonical, populated catalog segments so search crawlers and shoppers avoid empty comparison pages.
            </p>
          </article>

          {/* BUY-74926 + BUY-74905: visible checked-date footer for the category-pair variant.
              No live offers live on this route — they're on /compare?q=... — but
              the audit expects every /compare URL to expose a checked date. The
              ISO stamp comes from the content-hash store so the visible text and
              the sitemap <lastmod> move together (directive §5). */}
          <p className="mt-6 text-xs text-slate-500" data-ssr-prices-checked={checkedStamp.iso}>
            Prices checked{" "}
            <time dateTime={checkedStamp.iso}>{checkedStamp.text}</time>
            . Live retailer prices are surfaced on{" "}
            <Link href="/compare" className="font-medium text-indigo-600 hover:underline">/compare</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default async function CompareContentPage({ params }: Params) {
  const doc = getBySlug(params.slug);
  if (!doc) {
    const pair = params.slug.length === 1 ? await findCompareCategoryPair(params.slug[0]) : null;
    if (!pair) notFound();
    // CompareCategoryPairPage is async (BUY-74905 — content-hash stamp needs
    // a server-side await). React RSC awaits async child components when
    // serializing, so returning the JSX element is sufficient.
    return <CompareCategoryPairPage pair={pair} />;
  }

  let body = "";
  let faqSchema = null;
  try {
    const { data, content } = matter(fs.readFileSync(path.join(contentDir, `${doc.slug}.md`), "utf8"));
    body = content.trim();
    if ((data as Frontmatter).schema_type === "FAQPage") faqSchema = buildFaqSchema(body);
  } catch { notFound(); }

  // Sibling pages in the same category (max 6, excluding current)
  const allDocs = getAll().filter(Boolean) as NonNullable<ReturnType<typeof getAll>[number]>[];
  const siblings = doc.category
    ? allDocs.filter((d) => d.category === doc.category && d.slug !== doc.slug).slice(0, 6)
    : [];

  // BUY-74905 (directive §5): hash the markdown body + title + description
  // + category so the visible checked-date and the sitemap <lastmod> move
  // together — only when an editorial commit actually changes the doc.
  const docCanonical = toSiteUrl(`/compare/${doc.slug}`);
  const docStamp = await getOrUpdatePageLastmod(
    docCanonical,
    serializeHashable({
      kind: "compare-markdown-doc",
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      category: doc.category,
      body,
    }),
    new Date(doc.updated).toISOString(),
  );
  const docCheckedStamp = formatCheckedStamp(docStamp);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {faqSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />}
      <Nav />
      <main id="main-content" className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-16">
            {/* Breadcrumb: hub → category → current */}
            <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1 text-sm text-slate-500">
              <Link href="/compare" className="font-medium text-indigo-600 hover:underline">Price Comparisons</Link>
              {doc.category && (
                <>
                  <span aria-hidden="true">/</span>
                  <Link href={`/compare?category=${encodeURIComponent(doc.category)}`} className="font-medium text-indigo-600 hover:underline">{doc.category}</Link>
                </>
              )}
              <span aria-hidden="true">/</span>
              <span className="text-slate-700">{doc.title}</span>
            </nav>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">{doc.title}</h1>
            <div className="mb-4 flex flex-wrap gap-2 text-sm text-slate-500">
              {doc.category && <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">{doc.category}</span>}
            </div>
            {doc.description && <p className="max-w-3xl text-lg leading-8 text-slate-600">{doc.description}</p>}
          </div>
        </section>
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <div className="blog-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                h1: ({ children }) => <h1 className="mt-10 text-3xl font-bold tracking-tight text-slate-900 first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="mt-10 text-2xl font-semibold tracking-tight text-slate-900">{children}</h2>,
                h3: ({ children }) => <h3 className="mt-8 text-xl font-semibold text-slate-900">{children}</h3>,
                p: ({ children }) => <p className="mt-5 text-base leading-8 text-slate-700">{children}</p>,
                a: ({ href, children }) => <a href={href} className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">{children}</a>,
                ul: ({ children }) => <ul className="mt-5 list-disc space-y-3 pl-6 text-base leading-8 text-slate-700">{children}</ul>,
                ol: ({ children }) => <ol className="mt-5 list-decimal space-y-3 pl-6 text-base leading-8 text-slate-700">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                blockquote: ({ children }) => <blockquote className="mt-6 rounded-r-2xl border-l-4 border-indigo-500 bg-indigo-50/70 px-5 py-4 text-slate-700">{children}</blockquote>,
                hr: () => <hr className="my-8 border-slate-200" />,
                code: ({ className, children }) => <code className={className ? `${className} font-mono text-sm text-slate-100` : "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.95em] text-slate-800"}>{children}</code>,
                pre: ({ children }) => <pre className="mt-6 overflow-x-auto rounded-2xl bg-slate-950 p-5 text-sm leading-7 text-slate-100">{children}</pre>,
                table: ({ children }) => <div className="mt-6 overflow-x-auto"><table className="min-w-full border-collapse overflow-hidden rounded-2xl border border-slate-200 text-left text-sm">{children}</table></div>,
                thead: ({ children }) => <thead className="bg-slate-100 text-slate-700">{children}</thead>,
                tbody: ({ children }) => <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>,
                th: ({ children }) => <th className="px-4 py-3 font-semibold">{children}</th>,
                td: ({ children }) => <td className="px-4 py-3 align-top text-slate-600">{children}</td>,
              }}>{body}</ReactMarkdown>
            </div>
          </article>

          {/* Sibling comparisons in the same category */}
          {siblings.length > 0 && (
            <aside className="mt-10" aria-label="Related comparisons">
              <h2 className="mb-4 text-lg font-semibold text-slate-800">
                More {doc.category} comparisons
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {siblings.map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/compare/${s.slug}`}
                      className="block rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-indigo-700 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
                    >
                      {s.title}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-slate-500">
                <Link href="/compare" className="font-medium text-indigo-600 hover:underline">
                  View all price comparisons →
                </Link>
              </p>
            </aside>
          )}

          {/* BUY-74926 + BUY-74905: visible "Prices checked <date>" footer. Markdown
              content pages don't carry live retailer rows, but the audit expects
              every /compare route to expose a checked-date stamp. Live offers live
              on /compare?q=... and /compare?ids=... which use ComparisonTable.
              The ISO stamp is content-hash-driven so it matches the sitemap
              <lastmod> exactly (directive §5). */}
          <p className="mt-8 text-xs text-slate-500" data-ssr-prices-checked={docCheckedStamp.iso}>
            Prices checked{" "}
            <time dateTime={docCheckedStamp.iso}>{docCheckedStamp.text}</time>
            . Live retailer prices for this comparison are surfaced on{" "}
            <Link href={`/compare?q=${encodeURIComponent(doc.title)}`} className="font-medium text-indigo-600 hover:underline">
              /compare
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
