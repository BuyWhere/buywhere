import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const blogDirectory = path.join(process.cwd(), "content/blog");

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  author: string;
  publishedAt: string;
  lastUpdatedAt?: string;
  canonicalUrl?: string;
  coverImage?: string;
  tags: string[];
  jsonLd?: string;
  body: string;
};

type Frontmatter = {
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  lastUpdatedAt?: string;
  slug?: string;
  canonicalUrl?: string;
  coverImage?: string;
  tags?: string[];
  jsonLd?: unknown;
};

function parseBlogPost(fileName: string): BlogPost | null {
  const fullPath = path.join(blogDirectory, fileName);
  const source = fs.readFileSync(fullPath, "utf8");

  if (!source.startsWith("---")) {
    return null;
  }

  let data: matter.GrayMatterFile<string>["data"];
  let content: string;

  try {
    const parsed = matter(source);
    data = parsed.data;
    content = parsed.content;
  } catch {
    return null;
  }

  const frontmatter = data as Frontmatter;

  if (!frontmatter.slug || !frontmatter.title || !frontmatter.description || !frontmatter.publishedAt) {
    return null;
  }

  const publishedAtValue = frontmatter.publishedAt as string | Date;

  const publishedAtStr =
    publishedAtValue instanceof Date
      ? publishedAtValue.toISOString().slice(0, 10)
      : String(publishedAtValue);

  const lastUpdatedAtRaw = frontmatter.lastUpdatedAt as string | Date | undefined;
  let lastUpdatedAtStr = lastUpdatedAtRaw
    ? lastUpdatedAtRaw instanceof Date
      ? lastUpdatedAtRaw.toISOString().slice(0, 10)
      : String(lastUpdatedAtRaw)
    : publishedAtStr;

  // BUY-74667: enforce `lastUpdatedAt >= publishedAt`. A typed-in error or
  // editorial draft leftover can land a `lastUpdatedAt` BEFORE `publishedAt`,
  // which the page would render as "Published June 19, 2026 • Last updated
  // June 18, 2026" — a logical impossibility exposed by VidMee. Coerce back
  // to `publishedAt` (which the page uses to hide the "Last updated" row)
  // so the metadata header is always internally consistent.
  if (lastUpdatedAtStr < publishedAtStr) {
    lastUpdatedAtStr = publishedAtStr;
  }

  // Normalize jsonLd: both object (from YAML block) and string frontmatter
  // must end up as a safe JSON string before passing to dangerouslySetInnerHTML.
  let jsonLdStr: string | undefined;
  if (frontmatter.jsonLd !== undefined) {
    if (typeof frontmatter.jsonLd === "string") {
      // Already a string — validate it parses as JSON, then pass through.
      try {
        JSON.parse(frontmatter.jsonLd);
        jsonLdStr = frontmatter.jsonLd;
      } catch {
        // Malformed JSON string — stringify the raw value instead.
        jsonLdStr = JSON.stringify(frontmatter.jsonLd);
      }
    } else {
      // YAML block parsed to an object — serialize safely.
      jsonLdStr = JSON.stringify(frontmatter.jsonLd);
    }
  }

  return {
    slug: frontmatter.slug,
    title: frontmatter.title,
    description: frontmatter.description,
    author: frontmatter.author ?? "BuyWhere Team",
    publishedAt: publishedAtStr,
    lastUpdatedAt: lastUpdatedAtStr,
    canonicalUrl: frontmatter.canonicalUrl,
    coverImage: frontmatter.coverImage,
    tags: frontmatter.tags ?? [],
    jsonLd: jsonLdStr,
    body: content.trim(),
  };
}

export function getAllBlogPosts(): BlogPost[] {
  return fs
    .readdirSync(blogDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .map(parseBlogPost)
    .filter((post): post is BlogPost => post !== null)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  return getAllBlogPosts().find((post) => post.slug === slug);
}
