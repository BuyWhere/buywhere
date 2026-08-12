import { renderBlogAtomFeed, buildFeedResponse } from "@/lib/blog-feeds";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return buildFeedResponse(renderBlogAtomFeed(), "application/atom+xml");
}
