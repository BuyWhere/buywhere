export type Region = 'SG' | 'US' | 'SEA' | 'GLOBAL';

const REGION_CONFIG = {
  SG: {
    locale: 'en_SG',
    language: 'en-SG',
    currency: 'SGD',
    currencySymbol: 'S$',
    retailerLabel: 'Singapore retailers',
    baseTitle: 'BuyWhere — Compare prices across Singapore retailers',
    baseDescription: "Find the best prices for electronics, groceries, home goods, and health products across Singapore's top retailers. AI-powered price comparisons.",
    keywords: ['price comparison', 'Singapore', 'electronics', 'groceries', 'buy', 'compare prices', 'online shopping'],
  },
  US: {
    locale: 'en_US',
    language: 'en-US',
    currency: 'USD',
    currencySymbol: '$',
    retailerLabel: 'US retailers',
    baseTitle: 'BuyWhere — Compare prices across US retailers',
    baseDescription: 'Find the best prices for electronics, groceries, home goods, and health products across top US retailers. AI-powered price comparisons.',
    keywords: ['price comparison', 'United States', 'US', 'electronics', 'groceries', 'buy', 'compare prices', 'online shopping'],
  },
  SEA: {
    locale: 'en_MY',
    language: 'en-MY',
    currency: 'MYR',
    currencySymbol: 'RM',
    retailerLabel: 'Southeast Asian retailers',
    baseTitle: 'BuyWhere — Compare prices across SEA retailers',
    baseDescription: 'Find the best prices for electronics, groceries, home goods, and health products across Southeast Asian retailers. AI-powered price comparisons.',
    keywords: ['price comparison', 'Southeast Asia', 'SEA', 'electronics', 'groceries', 'buy', 'compare prices', 'online shopping'],
  },
  GLOBAL: {
    locale: 'en_GB',
    language: 'en-GB',
    currency: 'USD',
    currencySymbol: '$',
    retailerLabel: 'global retailers',
    baseTitle: 'BuyWhere — Compare prices across global retailers',
    baseDescription: 'Find the best prices for electronics, groceries, home goods, and health products across top global retailers. AI-powered price comparisons.',
    keywords: ['price comparison', 'global', 'electronics', 'groceries', 'buy', 'compare prices', 'online shopping'],
  },
} as const;

export function getRegion(): Region {
  const env = process.env.NEXT_PUBLIC_REGION;
  if (env && Object.hasOwn(REGION_CONFIG, env.toUpperCase())) {
    return env.toUpperCase() as Region;
  }
  const subdomain = process.env.NEXT_PUBLIC_BASE_URL || '';
  if (subdomain.includes('us.') || subdomain.includes('us.buywhere')) {
    return 'US';
  }
  return 'SG';
}

export function getRegionConfig(region: Region = getRegion()) {
  return REGION_CONFIG[region];
}

export function regionTitle(suffix: string, region: Region = getRegion()): string {
  const config = getRegionConfig(region);
  if (!suffix) return config.baseTitle;
  return `${suffix} | BuyWhere`;
}

export function regionDescription(text: string, region: Region = getRegion()): string {
  const config = getRegionConfig(region);
  return text.replace('Singapore retailers', config.retailerLabel);
}

export function regionKeywords(region: Region = getRegion()): readonly string[] {
  return getRegionConfig(region).keywords;
}

export function regionOpenGraph(region: Region = getRegion()) {
  const config = getRegionConfig(region);
  return {
    locale: config.locale,
    siteName: 'BuyWhere',
  };
}

export function regionAlternates(path: string, region: Region = getRegion()) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';
  const config = getRegionConfig(region);
  return {
    canonical: `${baseUrl}${path}`,
    languages: { [config.language]: `${baseUrl}${path}` },
  };
}
