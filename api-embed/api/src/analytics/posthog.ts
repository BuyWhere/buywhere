import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!POSTHOG_API_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
  }
  return client;
}

export interface ApiQueryEvent {
  apiKey: string;
  agentFramework: string;
  agentVersion: string;
  sdkLanguage: string;
  queryIntent: string;
  productCategories: string[];
  resultCount: number;
  responseTimeMs: number;
  signupChannel: string | null;
  sourcePage: string | null;
  endpoint: string;
}

export function trackApiQuery(event: ApiQueryEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: event.apiKey,
    event: 'api_query',
    properties: {
      agent_framework: event.agentFramework,
      agent_version: event.agentVersion,
      sdk_language: event.sdkLanguage,
      query_intent: event.queryIntent,
      product_categories: event.productCategories,
      result_count: event.resultCount,
      response_time_ms: event.responseTimeMs,
      signup_channel: event.signupChannel,
      source_page: event.sourcePage,
      endpoint: event.endpoint,
    },
  });
}

// BUY-71129: conversion event attribution. See api/src/analytics/posthog.ts
// for full rationale. distinctId priority: apiKeyId (uuid) > apiKey (hash) >
// 'anonymous'. Per-capture disableGeoip: false re-enables geo for this one
// revenue event without flipping the project-level default.
export interface AffiliateClickEvent {
  apiKeyId?: string | null;
  apiKey?: string | null;
  agentName?: string | null;
  signupChannel?: string | null;
  attributionSource?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  merchantName?: string | null;
  merchantDomain?: string | null;
  productTitle?: string | null;
  productCategory?: string | null;
  countryCode?: string | null;
  city?: string | null;
  productId: string;
  merchantId: string;
  affiliateLinkId: string;
  source: string;
  testMode?: boolean;
}

const ALLOWED_AFFILIATE_SOURCES = new Set([
  'product_card',
  'api_response',
  'compare_page',
  'mcp_tool_call',
  'landing_page',
  'test',
]);
function normalizeAffiliateSource(raw: string): string {
  if (typeof raw !== 'string') return 'unknown';
  const cleaned = raw.endsWith('\\') ? raw.slice(0, -1) : raw;
  if (ALLOWED_AFFILIATE_SOURCES.has(cleaned)) return cleaned;
  if (cleaned.startsWith('test') || cleaned.startsWith('rex-') || cleaned.startsWith('buy')) return 'test';
  return 'unknown';
}

export function trackAffiliateClick(event: AffiliateClickEvent): void {
  const ph = getClient();
  if (!ph) return;
  const distinctId = event.apiKeyId || event.apiKey || 'anonymous';
  const source = normalizeAffiliateSource(event.source);

  const props: Record<string, unknown> = {
    product_id: event.productId,
    merchant_id: event.merchantId,
    affiliate_link_id: event.affiliateLinkId,
    source,
  };
  if (event.apiKeyId) props.api_key_id = event.apiKeyId;
  if (event.agentName) props.agent_name = event.agentName;
  if (event.signupChannel) props.signup_channel = event.signupChannel;
  if (event.attributionSource) props.attribution_source = event.attributionSource;
  if (event.utmSource) props.utm_source = event.utmSource;
  if (event.utmMedium) props.utm_medium = event.utmMedium;
  if (event.utmCampaign) props.utm_campaign = event.utmCampaign;
  if (event.merchantName) props.merchant = event.merchantName;
  if (event.merchantDomain) props.merchant_domain = event.merchantDomain;
  if (event.productTitle) props.product_title = event.productTitle;
  if (event.productCategory) props.product_category = event.productCategory;
  if (event.countryCode) props.$geoip_country_code = event.countryCode;
  if (event.city) props.$geoip_city = event.city;
  if (event.testMode) props.$test_event = true;

  ph.capture({
    distinctId,
    event: 'affiliate_click',
    properties: props,
    disableGeoip: false,
  });
}

export function trackRegistration(apiKey: string, agentName: string, signupChannel: string | null, utmSource: string | null): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: apiKey,
    event: 'agent_registered',
    properties: {
      agent_name: agentName,
      signup_channel: signupChannel,
      utm_source: utmSource,
    },
  });
  ph.identify({
    distinctId: apiKey,
    properties: {
      agent_name: agentName,
      signup_channel: signupChannel,
      utm_source: utmSource,
      registered_at: new Date().toISOString(),
    },
  });
}

export interface ComparePageViewEvent {
  slug: string;
  productId: string;
  category: string;
  retailerCount: number;
  lowestPrice: number | null;
}

export function trackComparePageView(event: ComparePageViewEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: `compare:${event.slug}`,
    event: 'compare_page_view',
    properties: {
      slug: event.slug,
      product_id: event.productId,
      category: event.category,
      retailer_count: event.retailerCount,
      lowest_price: event.lowestPrice,
    },
  });
}

export interface CompareRetailerClickEvent {
  slug: string;
  retailer: string;
  price: number | null;
  rank: number;
}

export function trackCompareRetailerClick(event: CompareRetailerClickEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: `compare:${event.slug}`,
    event: 'compare_retailer_click',
    properties: {
      slug: event.slug,
      retailer: event.retailer,
      price: event.price,
      rank: event.rank,
    },
  });
}

export async function shutdownPostHog(): Promise<void> {
  if (client) {
    await client.shutdown();
  }
}

// BUY-22733: source-of-truth usage telemetry — one event per authenticated request.
// `toolName` set on MCP `tools/call` → emits `mcp_tool_call`; otherwise `api_query`.
// `timestamp` lets the backfill script post historical events at their original `query_log.created_at`.
// BUY-31298: added behavioral context fields so route handlers can pass extra analytics
// through res.locals without firing a separate legacy trackApiQuery event.
export interface ApiUsageEvent {
  apiKeyId: string;
  endpoint: string;
  method: string;
  tier: string;
  resultStatus: number;
  latencyMs: number;
  toolName?: string | null;
  timestamp?: Date;
  backfilled?: boolean;
  queryIntent?: string | null;
  productCategories?: string[] | null;
  signupChannel?: string | null;
  sourcePage?: string | null;
}

export function trackApiUsage(event: ApiUsageEvent): void {
  const ph = getClient();
  if (!ph) return;
  const isMcpToolCall = !!event.toolName;
  const extra: Record<string, unknown> = {};
  if (event.queryIntent) extra.query_intent = event.queryIntent;
  if (event.productCategories?.length) extra.product_categories = event.productCategories;
  if (event.signupChannel) extra.signup_channel = event.signupChannel;
  if (event.sourcePage) extra.source_page = event.sourcePage;
  ph.capture({
    distinctId: event.apiKeyId,
    event: isMcpToolCall ? 'mcp_tool_call' : 'api_query',
    properties: {
      endpoint: event.endpoint,
      method: event.method,
      tier: event.tier,
      api_key_id: event.apiKeyId,
      result_status: event.resultStatus,
      latency_ms: event.latencyMs,
      ...(isMcpToolCall ? { tool_name: event.toolName } : {}),
      ...(event.backfilled ? { backfilled: true } : {}),
      ...extra,
    },
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
  });
}

export function trackEmailVerified(apiKeyId: string, email: string): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: apiKeyId,
    event: 'email_verified',
    properties: {
      email,
      verified_at: new Date().toISOString(),
    },
  });
}

export interface ProductSearchEvent {
  apiKey: string;
  apiKeyId: string;
  queryText: string;
  resultCount: number;
  responseTimeMs: number;
}

export function trackProductSearch(event: ProductSearchEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: event.apiKey,
    event: 'product_search',
    properties: {
      api_key_id: event.apiKeyId,
      result_status: 200,
      latency_ms: event.responseTimeMs,
      query_text: event.queryText,
      result_count: event.resultCount,
      response_time_ms: event.responseTimeMs,
    },
  });
}

export interface ProductViewEvent {
  apiKey: string;
  apiKeyId: string;
  productId: string;
  retailer: string;
  category: string | null;
  latencyMs: number;
}

export function trackProductView(event: ProductViewEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: event.apiKey,
    event: 'product_view',
    properties: {
      api_key_id: event.apiKeyId,
      result_status: 200,
      latency_ms: event.latencyMs,
      product_id: event.productId,
      retailer: event.retailer,
      category: event.category,
    },
  });
}
