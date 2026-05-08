import Link from "next/link";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const directoryContentDir = path.join(process.cwd(), "content", "directory");

type ContentFrontmatter = {
  title?: string;
  description?: string;
  slug?: string;
  category?: string;
  tags?: string[];
};

function getAllDirectoryContent() {
  try {
    return fs.readdirSync(directoryContentDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(".md", ""))
      .filter((slug) => slug && !slug.includes("/"))
      .map((slug) => {
        try {
          const source = fs.readFileSync(path.join(directoryContentDir, `${slug}.md`), "utf8");
          const { data } = matter(source);
          const fm = data as ContentFrontmatter;
          return { slug: fm.slug || slug, title: fm.title || slug, description: fm.description || "", category: fm.category || "", tags: fm.tags || [] };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

export const metadata: Metadata = {
  title: "BuyWhere Directory — Listed on AI Agent & MCP Marketplaces",
  description: "Browse all platforms where BuyWhere is listed — MCP marketplaces, AI agent directories, API registries, and developer tool listings.",
  alternates: { canonical: "https://buywhere.ai/directory" },
};

export default function DirectoryIndexPage() {
  const allContent = getAllDirectoryContent();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />
      <main className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-16">
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">BuyWhere Directory</h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">Browse all platforms where BuyWhere is listed — MCP marketplaces, AI agent directories, API registries, and developer tool listings.</p>
          </div>
        </section>
        <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {allContent.map((doc) => (
              <Link key={doc!.slug} href={`/directory/${doc!.slug}`} className="group overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md">
                {doc!.category && <span className="mb-3 inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">{doc!.category}</span>}
                <h2 className="text-xl font-semibold text-slate-900 group-hover:text-indigo-600">{doc!.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{doc!.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {doc!.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{tag}</span>)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}