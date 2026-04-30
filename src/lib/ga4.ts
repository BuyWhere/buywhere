export interface GA4EventParams {
  event_category?: string;
  event_label?: string;
  value?: number;
  items?: GA4Item[];
  [key: string]: unknown;
}

export interface GA4Item {
  item_id: string;
  item_name: string;
  price?: number;
}

declare global {
  interface Window {
    gtag: (
      command: 'config' | 'event' | 'set',
      targetId: string,
      params?: Record<string, unknown>
    ) => void;
    dataLayer: unknown[];
  }
}

function getGA4MeasurementId(): string | null {
  if (typeof window === 'undefined') return null;
  return process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? null;
}

export function isGA4Enabled(): boolean {
  return Boolean(getGA4MeasurementId());
}

export function initGA4(): void {
  if (typeof window === 'undefined') return;
  const measurementId = getGA4MeasurementId();
  if (!measurementId) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function (...args: unknown[]) {
    window.dataLayer.push(args);
  };

  window.gtag('config', measurementId, {
    send_page_view: false,
  });
}

export function trackPageView(path: string, title: string): void {
  if (typeof window === 'undefined') return;
  const measurementId = getGA4MeasurementId();
  if (!measurementId) return;

  window.gtag('event', 'page_view', {
    page_location: path,
    page_title: title,
  });
}

export function trackSearch(searchTerm: string, resultCount: number): void {
  if (typeof window === 'undefined') return;
  const measurementId = getGA4MeasurementId();
  if (!measurementId) return;

  window.gtag('event', 'search', {
    event_category: 'engagement',
    event_label: searchTerm,
    value: resultCount,
  });
}

export function trackSelectItem(retailerName: string, productName: string, price?: number): void {
  if (typeof window === 'undefined') return;
  const measurementId = getGA4MeasurementId();
  if (!measurementId) return;

  window.gtag('event', 'select_item', {
    event_category: 'engagement',
    event_label: retailerName,
    items: [
      {
        item_id: productName,
        item_name: productName,
        price: price,
      },
    ],
  });
}

export function trackAffiliateClick(productName: string, retailerName: string): void {
  if (typeof window === 'undefined') return;
  const measurementId = getGA4MeasurementId();
  if (!measurementId) return;

  window.gtag('event', 'click_affiliate', {
    event_category: 'conversion',
    event_label: `${productName} - ${retailerName}`,
  });
}

export function trackSignUp(method: string, source: string): void {
  if (typeof window === 'undefined') return;
  const measurementId = getGA4MeasurementId();
  if (!measurementId) return;

  window.gtag('event', 'sign_up', {
    event_category: 'conversion',
    event_label: `${method} - ${source}`,
  });
}