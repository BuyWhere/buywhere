export async function GET(): Promise<Response> {
  // Product slug pages return 410 Gone (BUY-37747/BUY-37750).
  // This sitemap is deprecated — delete it from GSC to avoid coverage errors.
  return new Response(null, { status: 410 });
}
