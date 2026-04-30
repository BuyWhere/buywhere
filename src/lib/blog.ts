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
  canonicalUrl?: string;
  coverImage?: string;
  tags: string[];
  body: string;
};

type Frontmatter = {
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  slug?: string;
  canonicalUrl?: string;
  coverImage?: string;
  tags?: string[];
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

  return {
    slug: frontmatter.slug,
    title: frontmatter.title,
    description: frontmatter.description,
    author: frontmatter.author ?? "BuyWhere Team",
    publishedAt:
      publishedAtValue instanceof Date
        ? publishedAtValue.toISOString().slice(0, 10)
        : String(publishedAtValue),
    canonicalUrl: frontmatter.canonicalUrl,
    coverImage: frontmatter.coverImage,
    tags: frontmatter.tags ?? [],
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
