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

export interface AffiliateClickEvent {
  apiKey: string | null;
  productId: string;
  merchantId: string;
  affiliateLinkId: string;
  source: string;
}

export function trackAffiliateClick(event: AffiliateClickEvent): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: event.apiKey || 'anonymous',
    event: 'affiliate_click',
    properties: {
      product_id: event.productId,
      merchant_id: event.merchantId,
      affiliate_link_id: event.affiliateLinkId,
      source: event.source,
    },
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
