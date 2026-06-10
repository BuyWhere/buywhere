import { NextResponse } from 'next/server';

/**
 * Returns 410 Gone for all /products/sg/:slug requests.
 * These are dead Singapore product page URLs that Google discovered via JS crawl.
 * Returning 410 (instead of 404) signals Google to drop them from its index within days vs months.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Gone', message: 'This product page no longer exists.' },
    { status: 410 }
  );
}
