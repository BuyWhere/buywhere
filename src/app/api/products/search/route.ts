import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  'https://api.buywhere.ai'
).replace(/\/$/, '');

const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';
const ALLOWED_PARAMS = new Set(['q', 'country', 'country_code', 'limit', 'cursor', 'offset']);

export async function GET(request: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: 'missing_api_key', message: 'Search is not configured' },
      { status: 503 },
    );
  }

  const upstreamParams = new URLSearchParams();
  request.nextUrl.searchParams.forEach((value, key) => {
    if (ALLOWED_PARAMS.has(key)) {
      upstreamParams.set(key, value);
    }
  });

  const country = upstreamParams.get('country');
  if (country) {
    if (!upstreamParams.has('country_code')) {
      upstreamParams.set('country_code', country);
    }
    upstreamParams.delete('country');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/v1/products/search?${upstreamParams.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      cache: 'no-store',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        data ?? { error: 'search_failed', message: 'Search request failed' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'search_unavailable', message: 'Search service unavailable' },
      { status: 502 },
    );
  }
}
