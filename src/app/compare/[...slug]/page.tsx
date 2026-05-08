import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import Script from "next/script";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

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
          return { slug: fm.slug || slug, title, description: fm.description || "", category: fm.category || "", tags: fm.tags || [], schemaType: fm.schema_type || "" };
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
  if (!doc) return {};
  return {
    title: doc.title, description: doc.description,
    alternates: { canonical: `https://buywhere.ai/compare/${doc.slug}` },
    openGraph: { title: doc.title, description: doc.description, type: "website", url: `https://buywhere.ai/compare/${doc.slug}`, siteName: "BuyWhere" },
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

export default function CompareContentPage({ params }: Params) {
  const doc = getBySlug(params.slug);
  if (!doc) notFound();

  let body = "";
  let faqSchema = null;
  try {
    const { data, content } = matter(fs.readFileSync(path.join(contentDir, `${doc.slug}.md`), "utf8"));
    body = content.trim();
    if ((data as Frontmatter).schema_type === "FAQPage") faqSchema = buildFaqSchema(body);
  } catch { notFound(); }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {faqSchema && <Script id="faq-schema" type="application/ld+json" strategy="afterInteractive">{JSON.stringify(faqSchema)}</Script>}
      <Nav />
      <main className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-16">
            <Link href="/compare" className="mb-6 inline-flex text-sm font-medium text-indigo-600">← Back to compare</Link>
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
        </section>
      </main>
      <Footer />
    </div>
  );
}