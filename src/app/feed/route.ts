import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return NextResponse.redirect(new URL("/blog/rss.xml", "https://buywhere.ai"), 301);
}
