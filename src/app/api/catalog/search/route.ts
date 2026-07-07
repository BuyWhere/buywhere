import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  'https://api.buywhere.ai';
const SERVER_API_KEY =
  process.env.BUYWHERE_API_KEY ||
  process.env.BUYWHERE_SERVER_API_KEY ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
  '';

const ALLOWED_PARAMS = new Set([
  'q',
  'country',
  'country_code',
  'limit',
  'offset',
  'page',
  'cursor',
  'category',
  'brand',
  'merchant_id',
  'min_price',
  'max_price',
  'sort',
  'sort_by',
  'fields',
]);

function clampLimit(value: string | null) {
  const parsed = Number(value || '20');
  if (!Number.isFinite(parsed)) return '20';
  return String(Math.max(1, Math.min(40, Math.trunc(parsed))));
}

export async function GET(request: NextRequest) {
  const upstreamParams = new URLSearchParams();

  request.nextUrl.searchParams.forEach((value, key) => {
    if (ALLOWED_PARAMS.has(key)) {
      upstreamParams.set(key, value);
    }
  });

  const query = upstreamParams.get('q')?.trim() || '';
  if (query.length < 2) {
    return NextResponse.json({ items: [], total: 0, has_more: false });
  }

  upstreamParams.set('q', query);
  upstreamParams.set('limit', clampLimit(upstreamParams.get('limit')));
  if (!upstreamParams.get('country_code') && upstreamParams.get('country')) {
    upstreamParams.set('country_code', upstreamParams.get('country')!.toUpperCase());
  }
  if (!upstreamParams.get('fields')) {
    upstreamParams.set(
      'fields',
      'id,name,title,price,currency,source,merchant,image_url,url,buy_url,affiliate_url,affiliate_redirect_url,click_url,brand,category'
    );
  }

  const headers: HeadersInit = { Accept: 'application/json' };
  if (SERVER_API_KEY) {
    headers.Authorization = `Bearer ${SERVER_API_KEY}`;
  }

  const response = await fetch(`${API_BASE_URL}/v1/products/search?${upstreamParams.toString()}`, {
    headers,
    next: { revalidate: 60 },
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : { error: await response.text() };

  return NextResponse.json(body, {
    status: response.status,
    headers: {
      'Cache-Control': response.ok ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store',
    },
  });
}
