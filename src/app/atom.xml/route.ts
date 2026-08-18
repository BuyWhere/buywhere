import { buildBlogAtomResponse } from "@/lib/feed";

// BUY-69024: serve /atom.xml as a root-level Atom feed instead of falling through
// to [seo-page] dynamic route and returning an HTML 404 shell.
export function GET(): Response {
  return buildBlogAtomResponse();
}
