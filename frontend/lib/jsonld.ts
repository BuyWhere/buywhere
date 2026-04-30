import { ComparisonPageData, FAQItem } from '@/types/compare';

interface JSONLDProduct {
  '@context': 'https://schema.org';
  '@type': 'Product';
  name: string;
  image: string;
  description: string;
  brand: {
    '@type': 'Brand';
    name: string;
  };
  gtin?: string;
  offers: JSONLDOffer[];
}

interface JSONLDOffer {
  '@type': 'Offer';
  price: number;
  priceCurrency: string;
  availability: 'https://schema.org/InStock' | 'https://schema.org/LowStock' | 'https://schema.org/OutOfStock' | 'https://schema.org/OutOfStock';
  seller: {
    '@type': 'Organization';
    name: string;
  };
}

interface JSONLDAggregateOffer {
  '@context': 'https://schema.org';
  '@type': 'AggregateOffer';
  lowPrice: number;
  highPrice: number;
  priceCurrency: string;
  offerCount: number;
  offers: JSONLDOffer[];
}

interface JSONLDBreadcrumbList {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: Array<{
    '@type': 'ListItem';
    position: number;
    name: string;
    item: string;
  }>;
}

interface JSONLDFAQPage {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: Array<{
    '@type': 'Question';
    name: string;
    acceptedAnswer: {
      '@type': 'Answer';
      text: string;
    };
  }>;
}

export function generateProductJSONLD(data: ComparisonPageData): JSONLDProduct {
  const availabilityMap: Record<string, 'https://schema.org/InStock' | 'https://schema.org/LowStock' | 'https://schema.org/OutOfStock'> = {
    in_stock: 'https://schema.org/InStock',
    low_stock: 'https://schema.org/LowStock',
    out_of_stock: 'https://schema.org/OutOfStock',
    refresh_pending: 'https://schema.org/OutOfStock',
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: data.product.title,
    image: data.product.image_url,
    description: data.product.description,
    brand: {
      '@type': 'Brand',
      name: data.product.brand,
    },
    gtin: data.product.gtin,
    offers: data.retailers.map((retailer) => ({
      '@type': 'Offer',
      price: retailer.price,
      priceCurrency: 'SGD',
      availability: availabilityMap[retailer.availability],
      seller: {
        '@type': 'Organization',
        name: retailer.retailer_name,
      },
    })),
  };
}

export function generateAggregateOfferJSONLD(data: ComparisonPageData): JSONLDAggregateOffer {
  const prices = data.retailers.map((r) => r.price);
  const lowPrice = Math.min(...prices);
  const highPrice = Math.max(...prices);

  const availabilityMap: Record<string, 'https://schema.org/InStock' | 'https://schema.org/LowStock' | 'https://schema.org/OutOfStock'> = {
    in_stock: 'https://schema.org/InStock',
    low_stock: 'https://schema.org/LowStock',
    out_of_stock: 'https://schema.org/OutOfStock',
    refresh_pending: 'https://schema.org/OutOfStock',
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'AggregateOffer',
    lowPrice,
    highPrice,
    priceCurrency: 'SGD',
    offerCount: data.retailers.length,
    offers: data.retailers.map((retailer) => ({
      '@type': 'Offer',
      price: retailer.price,
      priceCurrency: 'SGD',
      availability: availabilityMap[retailer.availability],
      seller: {
        '@type': 'Organization',
        name: retailer.retailer_name,
      },
    })),
  };
}

export function generateBreadcrumbListJSONLD(
  data: ComparisonPageData,
  baseUrl: string = 'https://buywhere.ai'
): JSONLDBreadcrumbList {
  const items: Array<{ '@type': 'ListItem'; position: number; name: string; item: string }> = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
    { '@type': 'ListItem', position: 2, name: 'Compare', item: `${baseUrl}/compare` },
    ...data.breadcrumb.map((crumb, idx) => ({
      '@type': 'ListItem' as const,
      position: idx + 3,
      name: crumb.name,
      item: `${baseUrl}${crumb.url}`,
    })),
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

export function generateFAQPageJSONLD(faq: FAQItem[]): JSONLDFAQPage {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export interface JSONLDOutput {
  product: JSONLDProduct;
  aggregateOffer: JSONLDAggregateOffer;
  breadcrumbList: JSONLDBreadcrumbList;
  faqPage?: JSONLDFAQPage;
}

export function generateComparePageJSONLD(
  data: ComparisonPageData,
  baseUrl?: string
): JSONLDOutput {
  const output: JSONLDOutput = {
    product: generateProductJSONLD(data),
    aggregateOffer: generateAggregateOfferJSONLD(data),
    breadcrumbList: generateBreadcrumbListJSONLD(data, baseUrl),
  };

  if (data.faq && data.faq.length > 0) {
    output.faqPage = generateFAQPageJSONLD(data.faq);
  }

  return output;
}

export function jsonLDToScriptTag(jsonld: JSONLDOutput): string {
  return JSON.stringify(jsonld);
}