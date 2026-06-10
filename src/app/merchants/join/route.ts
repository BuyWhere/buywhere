import { NextResponse } from 'next/server';

/**
 * Returns 410 Gone for /merchants/join.
 * This page is dead and should either be restored or permanently removed from Google's index.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Gone', message: 'This page no longer exists.' },
    { status: 410 }
  );
}
