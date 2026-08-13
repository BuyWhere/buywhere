import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export interface CountryLandingConfig {
  slug: string;
  countryCode: string;
  countryName: string;
  flag: string;
  currency: string;
  locale: string;
  topRetailers: string[];
  headline: string;
  description: string;
  searchExamples: string[];
}

export const countryLandingPages = {
  sg: {
    slug: "sg",
    countryCode: "SG",
    countryName: "Singapore",
    flag: "🇸🇬",
    currency: "SGD",
    locale: "en_SG",
    topRetailers: ["Shopee", "Lazada", "Amazon Singapore", "FairPrice"],
    headline: "Compare prices across Singapore stores with BuyWhere",
    description:
      "Search Singapore catalog results across local and regional merchants, compare prices in SGD, and jump straight into BuyWhere search for smarter shopping decisions.",
    searchExamples: ["wireless earbuds", "air purifier", "robot vacuum"],
  },
  au: {
    slug: "au",
    countryCode: "AU",
    countryName: "Australia",
    flag: "🇦🇺",
    currency: "AUD",
    locale: "en_AU",
    topRetailers: ["Amazon Australia", "Kmart", "JB Hi-Fi", "Big W"],
    headline: "Compare prices across Australian stores with BuyWhere",
    description:
      "Explore Australia product results, compare retailer offers in AUD, and use BuyWhere search to find the best available deal faster.",
    searchExamples: ["laptop deals", "coffee machine", "noise cancelling headphones"],
  },
  my: {
    slug: "my",
    countryCode: "MY",
    countryName: "Malaysia",
    flag: "🇲🇾",
    currency: "MYR",
    locale: "en_MY",
    topRetailers: ["Shopee Malaysia", "Lazada Malaysia", "Zalora", "Watsons"],
    headline: "Compare prices across Malaysian stores with BuyWhere",
    description:
      "Search Malaysia catalog coverage, compare prices in MYR, and discover where to buy across marketplace and retailer results.",
    searchExamples: ["smartphone", "skincare", "gaming monitor"],
  },
  ph: {
    slug: "ph",
    countryCode: "PH",
    countryName: "Philippines",
    flag: "🇵🇭",
    currency: "PHP",
    locale: "en_PH",
    topRetailers: ["Shopee Philippines", "Lazada Philippines", "Zalora", "Watsons"],
    headline: "Compare prices across Philippine stores with BuyWhere",
    description:
      "Search Philippines product results, compare prices in PHP, and open BuyWhere search with the right market filter already applied.",
    searchExamples: ["phone accessories", "home appliances", "running shoes"],
  },
  uk: {
    slug: "uk",
    countryCode: "UK",
    countryName: "United Kingdom",
    flag: "🇬🇧",
    currency: "GBP",
    locale: "en_GB",
    topRetailers: ["Amazon UK", "Argos", "Currys", "John Lewis"],
    headline: "Compare prices across UK stores with BuyWhere",
    description:
      "Search UK product results, compare prices in GBP, and use BuyWhere to evaluate retailer offers before you buy.",
    searchExamples: ["4K monitor", "air fryer", "wireless keyboard"],
  },
  gb: {
    slug: "gb",
    countryCode: "GB",
    countryName: "United Kingdom",
    flag: "🇬🇧",
    currency: "GBP",
    locale: "en_GB",
    topRetailers: ["Amazon UK", "Argos", "Currys", "John Lewis"],
    headline: "Compare prices across Great Britain with BuyWhere",
    description:
      "Search Great Britain product results, compare prices in GBP, and use BuyWhere to find the best deals from UK retailers.",
    searchExamples: ["4K monitor", "air fryer", "wireless keyboard"],
  },
  ca: {
    slug: "ca",
    countryCode: "CA",
    countryName: "Canada",
    flag: "🇨🇦",
    currency: "CAD",
    locale: "en_CA",
    topRetailers: ["Amazon Canada", "Walmart Canada", "Best Buy Canada", "Canadian Tire"],
    headline: "Compare prices across Canadian stores with BuyWhere",
    description:
      "Search Canadian product results, compare prices in CAD, and find the best deals from Amazon Canada, Walmart, and more.",
    searchExamples: ["laptop", "headphones", "blender"],
  },
  de: {
    slug: "de",
    countryCode: "DE",
    countryName: "Germany",
    flag: "🇩🇪",
    currency: "EUR",
    locale: "de_DE",
    topRetailers: ["Amazon Germany", "Mediamarkt", "Saturn", "Otto"],
    headline: "Compare prices across German stores with BuyWhere",
    description:
      "Search German product results, compare prices in EUR, and find the best deals from Amazon Germany and other EU retailers.",
    searchExamples: ["laptop", "coffee machine", "wireless earbuds"],
  },
  fr: {
    slug: "fr",
    countryCode: "FR",
    countryName: "France",
    flag: "🇫🇷",
    currency: "EUR",
    locale: "fr_FR",
    topRetailers: ["Amazon France", "Cdiscount", "Fnac", "Darty"],
    headline: "Compare prices across French stores with BuyWhere",
    description:
      "Search French product results, compare prices in EUR, and find the best deals from Amazon France and other EU retailers.",
    searchExamples: ["smartphone", "tablet", "gaming console"],
  },
  in: {
    slug: "in",
    countryCode: "IN",
    countryName: "India",
    flag: "🇮🇳",
    currency: "INR",
    locale: "en_IN",
    topRetailers: ["Amazon India", "Flipkart", "Myntra", "Reliance Digital"],
    headline: "Compare prices across Indian stores with BuyWhere",
    description:
      "Search Indian product results, compare prices in INR, and find the best deals from Amazon India, Flipkart, and more.",
    searchExamples: ["smartphone", "laptop", "earbuds"],
  },
  eu: {
    slug: "eu",
    countryCode: "EU",
    countryName: "Europe",
    flag: "🇪🇺",
    currency: "EUR",
    locale: "en_EU",
    topRetailers: ["Amazon DE", "Amazon FR", "Amazon ES", "Amazon IT"],
    headline: "Compare prices across European stores with BuyWhere",
    description:
      "Search European product results, compare prices in EUR, and find the best deals from Amazon across Germany, France, Spain, and Italy.",
    searchExamples: ["laptop", "headphones", "smartwatch"],
  },
  ae: {
    slug: "ae",
    countryCode: "AE",
    countryName: "United Arab Emirates",
    flag: "🇦🇪",
    currency: "AED",
    locale: "en_AE",
    topRetailers: ["Amazon UAE", "Noon", "Carrefour", "Sharaf DG"],
    headline: "Compare prices across UAE stores with BuyWhere",
    description:
      "Search UAE product results, compare prices in AED, and find the best deals from Amazon UAE, Noon, and more.",
    searchExamples: ["smartphone", "laptop", "gaming"],
  },
  nz: {
    slug: "nz",
    countryCode: "NZ",
    countryName: "New Zealand",
    flag: "🇳🇿",
    currency: "NZD",
    locale: "en_NZ",
    topRetailers: ["Amazon New Zealand", "The Warehouse", "Noel Leeming", "PB Tech"],
    headline: "Compare prices across New Zealand stores with BuyWhere",
    description:
      "Search New Zealand product results, compare prices in NZD, and find the best deals from local and international retailers.",
    searchExamples: ["laptop", "tv", "appliances"],
  },
  jp: {
    slug: "jp",
    countryCode: "JP",
    countryName: "Japan",
    flag: "🇯🇵",
    currency: "JPY",
    locale: "ja_JP",
    topRetailers: ["Amazon Japan", "Rakuten", "Yodobashi", "Bic Camera"],
    headline: "Compare prices across Japanese stores with BuyWhere",
    description:
      "Search Japanese product results, compare prices in JPY, and find the best deals from Amazon Japan, Rakuten, and more.",
    searchExamples: ["electronics", "camera", "gaming"],
  },
  kr: {
    slug: "kr",
    countryCode: "KR",
    countryName: "South Korea",
    flag: "🇰🇷",
    currency: "KRW",
    locale: "ko_KR",
    topRetailers: ["Amazon Korea", "Coupang", "11st", "Gmarket"],
    headline: "Compare prices across Korean stores with BuyWhere",
    description:
      "Search Korean product results, compare prices in KRW, and find the best deals from Coupang, Amazon Korea, and more.",
    searchExamples: ["skincare", "electronics", "fashion"],
  },
  br: {
    slug: "br",
    countryCode: "BR",
    countryName: "Brazil",
    flag: "🇧🇷",
    currency: "BRL",
    locale: "pt_BR",
    topRetailers: ["Amazon Brazil", "Magazine Luiza", "Americanas", "Mercado Livre"],
    headline: "Compare prices across Brazilian stores with BuyWhere",
    description:
      "Search Brazilian product results, compare prices in BRL, and find the best deals from Amazon Brazil, Magazine Luiza, and more.",
    searchExamples: ["smartphone", "laptop", "electronics"],
  },
  mx: {
    slug: "mx",
    countryCode: "MX",
    countryName: "Mexico",
    flag: "🇲🇽",
    currency: "MXN",
    locale: "es_MX",
    topRetailers: ["Amazon Mexico", "Mercado Libre", "Liverpool", "Coppel"],
    headline: "Compare prices across Mexican stores with BuyWhere",
    description:
      "Search Mexican product results, compare prices in MXN, and find the best deals from Amazon Mexico, Mercado Libre, and more.",
    searchExamples: ["smartphone", "laptop", "tv"],
  },
  za: {
    slug: "za",
    countryCode: "ZA",
    countryName: "South Africa",
    flag: "🇿🇦",
    currency: "ZAR",
    locale: "en_ZA",
    topRetailers: ["Amazon South Africa", "Takealot", "Makro", "Game"],
    headline: "Compare prices across South African stores with BuyWhere",
    description:
      "Search South African product results, compare prices in ZAR, and find the best deals from Takealot, Amazon SA, and more.",
    searchExamples: ["laptop", "tv", "appliances"],
  },
} satisfies Record<string, CountryLandingConfig>;

export const COUNTRY_LANDING_SLUGS = Object.keys(countryLandingPages) as Array<keyof typeof countryLandingPages>;

export function buildCountryLandingMetadata(config: CountryLandingConfig): Metadata {
  const title = `BuyWhere ${config.countryCode} — Compare Prices in ${config.countryName}`;
  const description = `${config.description} Browse ${config.countryName} product results by country on BuyWhere.`;

  return {
    metadataBase: new URL("https://buywhere.ai"),
    title,
    description,
    keywords: [
      "price comparison",
      "buywhere",
      `buywhere ${config.countryCode.toLowerCase()}`,
      `${config.countryName} shopping`,
      `${config.currency} prices`,
      "product search",
      "deal alerts",
    ],
    openGraph: {
      type: "website",
      locale: config.locale,
      url: toSiteUrl(`/${config.slug}`),
      siteName: `BuyWhere ${config.countryCode}`,
      title,
      description,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `BuyWhere ${config.countryCode} - Compare prices in ${config.countryName}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: "@buywhere",
      creator: "@buywhere",
    },
    alternates: {
      canonical: toSiteUrl(`/${config.slug}`),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}
