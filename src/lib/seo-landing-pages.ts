import type { Metadata } from "next";

const BASE_URL = "https://buywhere.ai";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai";

export type LandingProduct = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  merchant: string;
  imageUrl: string | null;
  href: string;
  brand: string | null;
  category: string | null;
};

type SearchApiItem = {
  id: number | string;
  name?: string | null;
  title?: string | null;
  price?: number | string | null;
  currency?: string | null;
  source?: string | null;
  merchant?: string | null;
  image_url?: string | null;
  url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  brand?: string | null;
  category?: string | null;
};

type SearchApiResponse = {
  items?: SearchApiItem[];
  results?: SearchApiItem[];
};

type ComparisonRow = Record<string, string>;

type Highlight = {
  title: string;
  body: string;
};

type Faq = {
  question: string;
  answer: string;
};

type Cta = {
  title: string;
  body: string;
  href: string;
  label: string;
};

export type SeoLandingPageConfig = {
  slug: string;
  title: string;
  description: string;
  heroEyebrow: string;
  heroTitle: string;
  heroBody: string;
  canonicalPath: string;
  country: "US" | "SG";
  currency: "USD" | "SGD";
  locale: "en_US" | "en_SG";
  searchQuery: string;
  refreshedLabel: string;
  productSectionTitle: string;
  comparisonSectionTitle: string;
  comparisonColumns: string[];
  comparisonRows: ComparisonRow[];
  highlightSectionTitle: string;
  highlights: Highlight[];
  adviceSectionTitle: string;
  advicePoints: string[];
  faqSectionTitle: string;
  faqs: Faq[];
  shopperCta: Cta;
  developerCta: Cta;
  fallbackProducts: LandingProduct[];
};

function formatMerchantName(value?: string | null) {
  if (!value) return "BuyWhere seller";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeProduct(item: SearchApiItem, fallbackCurrency: string): LandingProduct {
  const numericPrice =
    typeof item.price === "number"
      ? item.price
      : typeof item.price === "string" && item.price.trim()
        ? Number(item.price)
        : null;

  return {
    id: String(item.id),
    name: item.name || item.title || "Untitled product",
    price: Number.isFinite(numericPrice) ? numericPrice : null,
    currency: item.currency || fallbackCurrency,
    merchant: formatMerchantName(item.merchant || item.source),
    imageUrl: item.image_url || null,
    href: item.affiliate_url || item.buy_url || item.url || "#",
    brand: item.brand || null,
    category: item.category || null,
  };
}

export async function getSeoLandingProducts(config: SeoLandingPageConfig): Promise<LandingProduct[]> {
  try {
    const params = new URLSearchParams({
      q: config.searchQuery,
      country: config.country,
      limit: "8",
    });

    const response = await fetch(`${API_BASE_URL}/v1/products/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 60 * 60 * 4 },
    });

    if (!response.ok) {
      throw new Error(`Search request failed with ${response.status}`);
    }

    const data = (await response.json()) as SearchApiResponse;
    const items = data.items || data.results || [];

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Search response was empty");
    }

    return items.map((item) => normalizeProduct(item, config.currency)).slice(0, 8);
  } catch {
    return config.fallbackProducts;
  }
}

export function buildSeoLandingMetadata(config: SeoLandingPageConfig): Metadata {
  const canonical = `${BASE_URL}${config.canonicalPath}`;

  return {
    title: config.title,
    description: config.description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: config.title,
      description: config.description,
      url: canonical,
      type: "article",
      locale: config.locale,
      siteName: "BuyWhere",
    },
    twitter: {
      card: "summary_large_image",
      title: config.title,
      description: config.description,
    },
  };
}

export function buildSeoLandingSchema(config: SeoLandingPageConfig, products: LandingProduct[]) {
  const canonical = `${BASE_URL}${config.canonicalPath}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "@id": `${BASE_URL}/#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: config.heroTitle,
            item: canonical,
          },
        ],
      },
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#collection`,
        name: config.heroTitle,
        description: config.description,
        url: canonical,
        mainEntityOfPage: canonical,
        isPartOf: {
          "@type": "WebSite",
          "@id": `${BASE_URL}/#website`,
          name: "BuyWhere",
          url: BASE_URL,
        },
        about: {
          "@type": "Thing",
          name: config.searchQuery,
        },
        mainEntity: {
          "@type": "ItemList",
          name: config.productSectionTitle,
          itemListElement: products.map((product, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: product.href,
            item: {
              "@type": "Product",
              name: product.name,
              brand: product.brand
                ? {
                    "@type": "Brand",
                    name: product.brand,
                  }
                : undefined,
              image: product.imageUrl || undefined,
              category: product.category || undefined,
              offers:
                product.price !== null
                  ? {
                      "@type": "Offer",
                      price: product.price,
                      priceCurrency: product.currency,
                      availability: "https://schema.org/InStock",
                      seller: {
                        "@type": "Organization",
                        "@id": `${BASE_URL}/#organization`,
                        name: product.merchant,
                      },
                      url: product.href,
                    }
                  : undefined,
            },
          })),
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        mainEntityOfPage: canonical,
        mainEntity: config.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };
}

export const seoLandingPages: Record<string, SeoLandingPageConfig> = {
  "air-purifier-singapore": {
    slug: "air-purifier-singapore",
    title: "Best Air Purifiers in Singapore 2026 | Compare Prices Across Top Retailers",
    description:
      "Compare the best air purifiers in Singapore with live BuyWhere product results, retailer benchmarks, and quick buying advice across Dyson, Philips, Xiaomi, Sharp, and Sterra.",
    heroEyebrow: "Singapore Home Guide",
    heroTitle: "Best Air Purifiers in Singapore",
    heroBody:
      "Singapore buyers usually compare air purifiers on room size coverage, filter replacement cost, and whether local retailers are running bundle promotions. This page combines those shopper questions with live BuyWhere search results so you can move from research to purchase faster.",
    canonicalPath: "/air-purifier-singapore",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "air purifier",
    refreshedLabel: "Updated May 1, 2026",
    productSectionTitle: "Live air purifier offers across Singapore",
    comparisonSectionTitle: "Popular air purifier picks at a glance",
    comparisonColumns: ["Model", "Price", "Coverage", "Filter", "Best For"],
    comparisonRows: [
      { Model: "Dyson Purifier Cool Gen1", Price: "S$699", Coverage: "Large rooms", Filter: "HEPA + carbon", "Best For": "Premium all-rounder" },
      { Model: "Philips 3000i Series", Price: "S$459", Coverage: "Living rooms", Filter: "NanoProtect HEPA", "Best For": "Balanced family choice" },
      { Model: "Xiaomi Smart Air Purifier 4", Price: "S$249", Coverage: "Bedrooms", Filter: "True HEPA", "Best For": "Best value" },
      { Model: "Sharp Plasmacluster FP-J80E", Price: "S$399", Coverage: "Medium rooms", Filter: "HEPA + deodorising", "Best For": "Quiet operation" },
      { Model: "Sterra Breeze Pro", Price: "S$329", Coverage: "Bedrooms", Filter: "HEPA", "Best For": "Local DTC option" },
    ],
    highlightSectionTitle: "What matters most for SG buyers",
    highlights: [
      {
        title: "Filter replacement cost matters",
        body: "A lower sticker price is not always cheaper over 12 months. Check the cost and frequency of replacement filters before deciding.",
      },
      {
        title: "Bedroom noise is a deal-breaker",
        body: "For HDB bedrooms, noise on the low setting often matters more than maximum airflow specs.",
      },
      {
        title: "Campaign vouchers move prices",
        body: "Shopee, Lazada, and local electronics chains often rotate vouchers that can materially change the real landed price.",
      },
    ],
    adviceSectionTitle: "How to choose an air purifier",
    advicePoints: [
      "Match the purifier's room-size recommendation to your actual bedroom or living room, not just the marketing headline.",
      "If haze, dust, or pet dander is the concern, prioritize true HEPA filtration over app features.",
      "Compare official brand stores, Shopee Mall, LazMall, and major electronics chains before buying.",
      "Double-check the annual filter cost so a cheaper upfront unit does not become the more expensive long-term option.",
    ],
    faqSectionTitle: "Air purifier Singapore FAQ",
    faqs: [
      {
        question: "What is the best air purifier in Singapore right now?",
        answer:
          "For many households, the Philips 3000i and Dyson Purifier Cool remain strong picks because they balance filtration performance, local availability, and trusted after-sales support.",
      },
      {
        question: "Is an air purifier worth buying in Singapore?",
        answer:
          "Yes, especially for bedrooms, homes with pets, or buyers sensitive to dust and haze. The biggest benefit is better day-to-day air quality in enclosed rooms.",
      },
      {
        question: "What should I compare besides price?",
        answer:
          "Look at room coverage, noise, official warranty coverage, and the ongoing cost of filters before choosing the cheapest listing.",
      },
    ],
    shopperCta: {
      title: "Compare air purifier prices in Singapore",
      body: "Check live offers across Singapore retailers in one BuyWhere search flow.",
      href: "/search?q=air+purifier&country=sg",
      label: "Shop air purifiers",
    },
    developerCta: {
      title: "Build Singapore home-appliance comparison flows",
      body: "Use BuyWhere APIs to track product availability and pricing across electronics marketplaces and local retailers.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: [
      { id: "ap1", name: "Dyson Purifier Cool Gen1", price: 699, currency: "SGD", merchant: "Dyson Singapore", imageUrl: null, href: "/search?q=Dyson+Purifier+Cool+Gen1&country=sg", brand: "Dyson", category: "Air Purifiers" },
      { id: "ap2", name: "Philips 3000i Series Air Purifier", price: 459, currency: "SGD", merchant: "Philips", imageUrl: null, href: "/search?q=Philips+3000i+air+purifier&country=sg", brand: "Philips", category: "Air Purifiers" },
      { id: "ap3", name: "Xiaomi Smart Air Purifier 4", price: 249, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=Xiaomi+Smart+Air+Purifier+4&country=sg", brand: "Xiaomi", category: "Air Purifiers" },
      { id: "ap4", name: "Sharp Plasmacluster FP-J80E", price: 399, currency: "SGD", merchant: "Lazada", imageUrl: null, href: "/search?q=Sharp+Plasmacluster+FP-J80E&country=sg", brand: "Sharp", category: "Air Purifiers" },
      { id: "ap5", name: "Sterra Breeze Pro", price: 329, currency: "SGD", merchant: "Sterra", imageUrl: null, href: "/search?q=Sterra+Breeze+Pro&country=sg", brand: "Sterra", category: "Air Purifiers" },
    ],
  },
  "laptop-singapore": {
    slug: "laptop-singapore",
    title: "Best Laptops in Singapore 2026 | Compare Laptop Prices Across SG Retailers",
    description:
      "Compare the best laptops in Singapore with live BuyWhere listings, retailer price checks, and quick buying advice across Apple, ASUS, Lenovo, HP, Acer, and Dell.",
    heroEyebrow: "Singapore Laptop Guide",
    heroTitle: "Best Laptops in Singapore",
    heroBody:
      "Laptop buyers in Singapore usually want one page that answers both product fit and price comparison. This landing page combines practical buying guidance with live BuyWhere results across marketplace and electronics-retail channels.",
    canonicalPath: "/laptop-singapore",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "laptop",
    refreshedLabel: "Updated May 1, 2026",
    productSectionTitle: "Live laptop offers across Singapore",
    comparisonSectionTitle: "Popular laptop picks at a glance",
    comparisonColumns: ["Model", "Price", "Weight", "Chip", "Best For"],
    comparisonRows: [
      { Model: "MacBook Air 13 M3", Price: "S$1,499", Weight: "1.24kg", Chip: "Apple M3", "Best For": "Best ultraportable" },
      { Model: "ASUS Zenbook 14 OLED", Price: "S$1,699", Weight: "1.28kg", Chip: "Intel Core Ultra 7", "Best For": "Best Windows all-rounder" },
      { Model: "Lenovo Yoga 7i", Price: "S$1,549", Weight: "1.49kg", Chip: "Intel Core Ultra 7", "Best For": "Best 2-in-1" },
      { Model: "Acer Swift Go 14", Price: "S$1,199", Weight: "1.32kg", Chip: "Intel Core Ultra 5", "Best For": "Best value" },
      { Model: "Dell XPS 14", Price: "S$2,199", Weight: "1.68kg", Chip: "Intel Core Ultra 7", "Best For": "Best premium Windows" },
    ],
    highlightSectionTitle: "What SG buyers usually optimise for",
    highlights: [
      {
        title: "Portability matters most",
        body: "For students and office workers commuting daily, weight and battery life often matter more than raw benchmark numbers.",
      },
      {
        title: "Marketplace pricing can beat retail",
        body: "Shopee and Lazada campaigns can undercut direct-brand pricing, but buyers should still verify warranty and seller quality.",
      },
      {
        title: "Local retail still matters",
        body: "Challenger, Courts, and Harvey Norman remain relevant when you want instalments, bundle promos, or in-store pickup.",
      },
    ],
    adviceSectionTitle: "How to choose the right laptop",
    advicePoints: [
      "Pick by primary use case first: portability, school, office work, creative apps, or gaming.",
      "For most non-gaming buyers, 16GB RAM and 512GB SSD is the current practical baseline.",
      "Compare official stores against marketplace flagship stores before buying.",
      "Check whether the listed price depends on vouchers, card promotions, or student discounts.",
    ],
    faqSectionTitle: "Laptop Singapore FAQ",
    faqs: [
      {
        question: "What is the best laptop for most buyers in Singapore?",
        answer:
          "For many buyers, a MacBook Air or a premium 14-inch Windows ultraportable offers the best balance of battery life, portability, and day-to-day performance.",
      },
      {
        question: "Where should I compare laptop prices in Singapore?",
        answer:
          "Buyers usually compare official brand stores, Shopee Mall, LazMall, Challenger, Courts, and Harvey Norman to find the lowest real checkout price.",
      },
      {
        question: "Should I buy from a marketplace or a local retailer?",
        answer:
          "Marketplace flagship stores often win on vouchers, while local retailers are useful for instalments, bundles, and easier physical support routes.",
      },
    ],
    shopperCta: {
      title: "Compare laptop prices in Singapore",
      body: "See live laptop offers across Singapore retailers in one search flow.",
      href: "/search?q=laptop&country=sg",
      label: "Shop laptops",
    },
    developerCta: {
      title: "Build laptop comparison tools for Singapore",
      body: "Use BuyWhere to power local price-comparison and product-discovery experiences across SG electronics retailers.",
      href: "/developers",
      label: "View developer docs",
    },
    fallbackProducts: [
      { id: "lp1", name: "MacBook Air 13 M3", price: 1499, currency: "SGD", merchant: "Apple Store", imageUrl: null, href: "/search?q=MacBook+Air+M3&country=sg", brand: "Apple", category: "Laptops" },
      { id: "lp2", name: "ASUS Zenbook 14 OLED", price: 1699, currency: "SGD", merchant: "ASUS Singapore", imageUrl: null, href: "/search?q=ASUS+Zenbook+14+OLED&country=sg", brand: "ASUS", category: "Laptops" },
      { id: "lp3", name: "Lenovo Yoga 7i", price: 1549, currency: "SGD", merchant: "Lenovo", imageUrl: null, href: "/search?q=Lenovo+Yoga+7i&country=sg", brand: "Lenovo", category: "Laptops" },
      { id: "lp4", name: "Acer Swift Go 14", price: 1199, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=Acer+Swift+Go+14&country=sg", brand: "Acer", category: "Laptops" },
      { id: "lp5", name: "Dell XPS 14", price: 2199, currency: "SGD", merchant: "Dell", imageUrl: null, href: "/search?q=Dell+XPS+14&country=sg", brand: "Dell", category: "Laptops" },
    ],
  },
  "best-gaming-laptops-us": {
    slug: "best-gaming-laptops-us",
    title: "Best Gaming Laptops in 2026 | Top RTX Gaming Laptop Deals Compared",
    description:
      "Compare the best gaming laptops in the US with live BuyWhere search results, price benchmarks, and buying advice across ASUS ROG, Lenovo Legion, Alienware, HP Omen, and Acer Predator.",
    heroEyebrow: "US Laptop Guide",
    heroTitle: "Best Gaming Laptops in 2026",
    heroBody:
      "Gaming laptops in 2026 handle competitive play, AAA releases, streaming, and creative workloads without forcing most buyers into a desktop. This page combines editorial picks with live BuyWhere search results so you can move from research to price comparison without leaving the page.",
    canonicalPath: "/best-gaming-laptops-us",
    country: "US",
    currency: "USD",
    locale: "en_US",
    searchQuery: "gaming laptop",
    refreshedLabel: "Refreshed April 26, 2026",
    productSectionTitle: "Live gaming laptop deals across US retailers",
    comparisonSectionTitle: "Top gaming laptop picks at a glance",
    comparisonColumns: ["Model", "Price", "GPU", "CPU", "Display", "Best For"],
    comparisonRows: [
      { Model: "ASUS ROG Zephyrus G16", Price: "$1,999", GPU: "RTX 5070", CPU: "Intel Core Ultra 9", Display: '16" OLED 240Hz', "Best For": "Best overall" },
      { Model: "Lenovo Legion Pro 7i", Price: "$2,299", GPU: "RTX 5080", CPU: "Intel Core Ultra 9", Display: '16" 240Hz IPS', "Best For": "Best performance" },
      { Model: "Alienware m16 R3", Price: "$2,499", GPU: "RTX 5080", CPU: "Intel Core Ultra 9", Display: '16" QHD+ 240Hz', "Best For": "Best premium build" },
      { Model: "HP Omen Transcend 14", Price: "$1,699", GPU: "RTX 5070", CPU: "Intel Core Ultra 7", Display: '14" OLED 120Hz', "Best For": "Best portable option" },
      { Model: "Acer Predator Helios Neo 16", Price: "$1,499", GPU: "RTX 5060", CPU: "Intel Core i9", Display: '16" 240Hz IPS', "Best For": "Best value" },
      { Model: "ASUS TUF Gaming A15", Price: "$1,199", GPU: "RTX 4060", CPU: "AMD Ryzen 9", Display: '15.6" 165Hz IPS', "Best For": "Best under $1,300" },
    ],
    highlightSectionTitle: "What stands out in this category",
    highlights: [
      {
        title: "ASUS ROG Zephyrus G16",
        body: "The most balanced option for buyers who want premium design, an OLED panel, and enough RTX headroom for modern 1440p gaming.",
      },
      {
        title: "Lenovo Legion Pro 7i",
        body: "The raw-performance choice when thermals, wattage, and desktop-like frame rates matter more than portability.",
      },
      {
        title: "HP Omen Transcend 14",
        body: "A better fit for commuters and students who need a machine that can travel well and still play modern games confidently.",
      },
    ],
    adviceSectionTitle: "How to choose the right gaming laptop",
    advicePoints: [
      "Prioritize the GPU before the CPU if your primary goal is gaming performance.",
      "RTX 4060 and 5060 class machines are still practical for 1080p high settings and tighter budgets.",
      "Check for upgradeable RAM, extra M.2 storage, and USB4 or Thunderbolt before you buy.",
      "Memorial Day, Prime Day, back-to-school season, Black Friday, and Cyber Monday remain the strongest US discount windows.",
    ],
    faqSectionTitle: "Gaming laptop FAQ",
    faqs: [
      {
        question: "What is the best gaming laptop in 2026?",
        answer:
          "For most buyers, the ASUS ROG Zephyrus G16 remains the best overall pick because it combines RTX 5070-class performance, a high-quality OLED display, and a more portable design than bulkier rivals.",
      },
      {
        question: "Is RTX 4060 still good for gaming in 2026?",
        answer:
          "Yes. RTX 4060 gaming laptops are still a strong fit for 1080p gaming, esports titles, and many AAA games on high settings, especially below the $1,300 mark.",
      },
      {
        question: "Should I buy 16GB or 32GB RAM in a gaming laptop?",
        answer:
          "For most gamers, 16GB is still enough. Choose 32GB if you stream, edit video, run creative apps, or want more headroom for future games.",
      },
    ],
    shopperCta: {
      title: "Compare gaming laptop prices across the US",
      body: "Track live deals on ASUS ROG, Lenovo Legion, Alienware, HP Omen, and more from one search flow.",
      href: "/search?q=gaming+laptop&country=us",
      label: "Shop gaming laptops",
    },
    developerCta: {
      title: "Build gaming laptop deal finders",
      body: "Use BuyWhere search and catalog endpoints to monitor pricing and availability across US retailers.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: [
      { id: "g1", name: "ASUS ROG Zephyrus G16", price: 1999, currency: "USD", merchant: "Best Buy", imageUrl: null, href: "/search?q=ASUS+ROG+Zephyrus+G16&country=us", brand: "ASUS", category: "Gaming Laptops" },
      { id: "g2", name: "Lenovo Legion Pro 7i", price: 2299, currency: "USD", merchant: "Lenovo", imageUrl: null, href: "/search?q=Lenovo+Legion+Pro+7i&country=us", brand: "Lenovo", category: "Gaming Laptops" },
      { id: "g3", name: "Alienware m16 R3", price: 2499, currency: "USD", merchant: "Dell", imageUrl: null, href: "/search?q=Alienware+m16+R3&country=us", brand: "Alienware", category: "Gaming Laptops" },
      { id: "g4", name: "HP Omen Transcend 14", price: 1699, currency: "USD", merchant: "HP", imageUrl: null, href: "/search?q=HP+Omen+Transcend+14&country=us", brand: "HP", category: "Gaming Laptops" },
      { id: "g5", name: "Acer Predator Helios Neo 16", price: 1499, currency: "USD", merchant: "Acer", imageUrl: null, href: "/search?q=Acer+Predator+Helios+Neo+16&country=us", brand: "Acer", category: "Gaming Laptops" },
      { id: "g6", name: "ASUS TUF Gaming A15", price: 1199, currency: "USD", merchant: "Amazon", imageUrl: null, href: "/search?q=ASUS+TUF+Gaming+A15&country=us", brand: "ASUS", category: "Gaming Laptops" },
    ],
  },
  "iphone-16-price-singapore": {
    slug: "iphone-16-price-singapore",
    title: "Cheapest iPhone 16 in Singapore 2026 | Compare Prices Across Apple, Shopee, Lazada",
    description:
      "Find the cheapest iPhone 16 in Singapore with live BuyWhere results, retailer benchmarks, and quick guidance across Apple Store, Shopee, Lazada, Amazon.sg, Challenger, and Courts.",
    heroEyebrow: "Singapore Price Tracker",
    heroTitle: "Cheapest iPhone 16 in Singapore",
    heroBody:
      "This page is built for the broad iPhone 16 SG search intent: fast price checks, trusted sellers, and a clear path to the lowest landed cost. We combine BuyWhere search results with a retailer snapshot so you can compare official channels against marketplace campaigns.",
    canonicalPath: "/iphone-16-price-singapore",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "iPhone 16",
    refreshedLabel: "Updated April 26, 2026",
    productSectionTitle: "Live iPhone 16 offers across Singapore",
    comparisonSectionTitle: "Retailer price benchmarks",
    comparisonColumns: ["Merchant", "128GB", "256GB", "Delivery", "Notes"],
    comparisonRows: [
      { Merchant: "Apple Store Online", "128GB": "From S$1,299", "256GB": "From S$1,499", Delivery: "Free express delivery", Notes: "Official pricing and AppleCare+" },
      { Merchant: "Shopee Mall resellers", "128GB": "From S$1,239", "256GB": "From S$1,429", Delivery: "Voucher-dependent", Notes: "Best flash-sale potential" },
      { Merchant: "Lazada authorised resellers", "128GB": "From S$1,249", "256GB": "From S$1,439", Delivery: "Fast local delivery", Notes: "Strong 9.9 and 11.11 promos" },
      { Merchant: "Amazon.sg", "128GB": "From S$1,269", "256GB": "From S$1,459", Delivery: "Prime eligible on select listings", Notes: "Good for quick delivery" },
      { Merchant: "Challenger", "128GB": "From S$1,279", "256GB": "From S$1,469", Delivery: "Standard local shipping", Notes: "Trusted local chain" },
      { Merchant: "Courts", "128GB": "From S$1,279", "256GB": "From S$1,469", Delivery: "Scheduled delivery available", Notes: "Installment options" },
    ],
    highlightSectionTitle: "How Singapore buyers usually save",
    highlights: [
      {
        title: "Marketplaces win on vouchers",
        body: "Shopee and Lazada usually deliver the lowest headline prices during 5.5, 6.6, 9.9, 11.11, and 12.12 campaign windows.",
      },
      {
        title: "Apple wins on certainty",
        body: "Apple Store remains the cleanest checkout path if you care more about warranty simplicity and official support than the lowest possible price.",
      },
      {
        title: "Local retailers matter for installments",
        body: "Courts and Harvey Norman tend to be the most useful when you want bank promos or instalment flexibility instead of pure cash-price savings.",
      },
    ],
    adviceSectionTitle: "What to check before buying",
    advicePoints: [
      "For most buyers, the 128GB model still offers the best value in Singapore.",
      "Only buy marketplace listings from Apple Authorised Resellers, Shopee Mall, or LazMall stores with clear warranty language.",
      "Confirm whether the listed price depends on stackable vouchers or card promos before you check out.",
      "If you are price-sensitive, 9.9, 11.11, and 12.12 are usually the strongest sale windows.",
    ],
    faqSectionTitle: "iPhone 16 Singapore FAQ",
    faqs: [
      {
        question: "What is the cheapest iPhone 16 price in Singapore right now?",
        answer:
          "Recent marketplace deals have put the iPhone 16 128GB around S$1,239 through Shopee or Lazada voucher campaigns, while Apple Store pricing starts from S$1,299.",
      },
      {
        question: "Is Apple Store the cheapest place to buy iPhone 16 in Singapore?",
        answer:
          "No. Apple Store offers the cleanest official purchase flow, but marketplace campaigns on Shopee and Lazada often beat Apple pricing by S$50 to S$100 or more.",
      },
      {
        question: "Should I wait for 11.11 to buy an iPhone 16 in Singapore?",
        answer:
          "If you do not need the phone immediately, waiting for 9.9, 11.11, or 12.12 usually gives you a better chance of seeing the lowest price.",
      },
    ],
    shopperCta: {
      title: "Compare iPhone 16 prices in Singapore",
      body: "Browse Apple, Shopee, Lazada, Amazon.sg, and local electronics retailers in one search view.",
      href: "/search?q=iPhone%2016&country=sg",
      label: "Shop iPhone 16",
    },
    developerCta: {
      title: "Build Singapore smartphone price trackers",
      body: "Use BuyWhere product search to monitor iPhone pricing, merchant coverage, and sale-event swings across SG retailers.",
      href: "/developers",
      label: "View developer docs",
    },
    fallbackProducts: [
      { id: "i1", name: "Apple iPhone 16 128GB", price: 1239, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=iPhone%2016%20128GB&country=sg", brand: "Apple", category: "Smartphones" },
      { id: "i2", name: "Apple iPhone 16 256GB", price: 1429, currency: "SGD", merchant: "Lazada", imageUrl: null, href: "/search?q=iPhone%2016%20256GB&country=sg", brand: "Apple", category: "Smartphones" },
      { id: "i3", name: "Apple iPhone 16 128GB", price: 1299, currency: "SGD", merchant: "Apple Store", imageUrl: null, href: "/search?q=Apple%20iPhone%2016&country=sg", brand: "Apple", category: "Smartphones" },
      { id: "i4", name: "Apple iPhone 16 256GB", price: 1459, currency: "SGD", merchant: "Amazon.sg", imageUrl: null, href: "/search?q=iPhone%2016%20256GB&country=sg", brand: "Apple", category: "Smartphones" },
      { id: "i5", name: "Apple iPhone 16 128GB", price: 1279, currency: "SGD", merchant: "Challenger", imageUrl: null, href: "/search?q=iPhone%2016%20128GB&country=sg", brand: "Apple", category: "Smartphones" },
      { id: "i6", name: "Apple iPhone 16 128GB", price: 1279, currency: "SGD", merchant: "Courts", imageUrl: null, href: "/search?q=iPhone%2016%20128GB&country=sg", brand: "Apple", category: "Smartphones" },
    ],
  },
  "best-robot-vacuums-2026": {
    slug: "best-robot-vacuums-2026",
    title: "Best Robot Vacuums in 2026 | Top Robot Vacuum Deals Compared",
    description:
      "Compare the best robot vacuums in the US with live BuyWhere search results, price anchors, and buying advice across Roborock, iRobot, Shark, Ecovacs, and eufy.",
    heroEyebrow: "US Home Guide",
    heroTitle: "Best Robot Vacuums in 2026",
    heroBody:
      "Robot vacuums in 2026 are better at navigation, self-emptying, and mopping than earlier generations, but the category is also harder to decode quickly. This page pairs editorial recommendations with live BuyWhere product listings so shoppers can move directly from research into current offers.",
    canonicalPath: "/best-robot-vacuums-2026",
    country: "US",
    currency: "USD",
    locale: "en_US",
    searchQuery: "robot vacuum",
    refreshedLabel: "Refreshed April 26, 2026",
    productSectionTitle: "Live robot vacuum deals across the US",
    comparisonSectionTitle: "Top robot vacuum picks at a glance",
    comparisonColumns: ["Model", "Price", "Suction", "Mop", "Self-Emptying", "Best For"],
    comparisonRows: [
      { Model: "Roborock S8 MaxV Ultra", Price: "$1,299", Suction: "10,000 Pa", Mop: "Yes", "Self-Emptying": "Yes", "Best For": "Best overall" },
      { Model: "iRobot Roomba Combo j9+", Price: "$999", Suction: "Strong", Mop: "Yes", "Self-Emptying": "Yes", "Best For": "Best for pet owners" },
      { Model: "Shark PowerDetect 2-in-1", Price: "$699", Suction: "Strong", Mop: "Yes", "Self-Emptying": "Yes", "Best For": "Best mid-range value" },
      { Model: "Ecovacs Deebot X2 Omni", Price: "$1,099", Suction: "8,000 Pa", Mop: "Yes", "Self-Emptying": "Yes", "Best For": "Best navigation" },
      { Model: "eufy X10 Pro Omni", Price: "$799", Suction: "8,000 Pa", Mop: "Yes", "Self-Emptying": "Yes", "Best For": "Best value premium" },
      { Model: "Roborock Q5 Pro+", Price: "$499", Suction: "5,500 Pa", Mop: "No", "Self-Emptying": "Yes", "Best For": "Best under $500" },
    ],
    highlightSectionTitle: "What separates the best picks",
    highlights: [
      {
        title: "Roborock S8 MaxV Ultra",
        body: "The safest premium recommendation if you want strong suction, dependable mopping, and a dock that minimizes manual maintenance.",
      },
      {
        title: "Roomba Combo j9+",
        body: "A strong fit for homes with pets thanks to obstacle avoidance, scheduling reliability, and broad retail support.",
      },
      {
        title: "Roborock Q5 Pro+",
        body: "The practical buy for shoppers who care more about vacuuming value than mopping features or luxury docks.",
      },
    ],
    adviceSectionTitle: "How to choose a robot vacuum",
    advicePoints: [
      "If your home is mostly hard floors, a vacuum-and-mop combo usually saves more time than a vacuum-only model.",
      "For carpet-heavy homes, prioritize suction, brushroll design, and self-emptying over headline mopping features.",
      "Check maintenance costs for filters, brushes, and mop pads before treating a flagship robot as the better deal.",
      "Prime Day, Black Friday, Cyber Monday, Presidents Day, and Memorial Day are the strongest US discount windows.",
    ],
    faqSectionTitle: "Robot vacuum FAQ",
    faqs: [
      {
        question: "What is the best robot vacuum in 2026?",
        answer:
          "For most buyers, the Roborock S8 MaxV Ultra is the best robot vacuum in 2026 because it combines strong cleaning, dependable navigation, effective mopping, and one of the best all-in-one docks available.",
      },
      {
        question: "Are robot vacuums worth it in 2026?",
        answer:
          "Yes. Robot vacuums are worth it for busy households that want consistent daily floor maintenance with less manual effort. The main value is time saved and better routine upkeep.",
      },
      {
        question: "Is Roborock better than Roomba in 2026?",
        answer:
          "In overall hardware value and mopping performance, Roborock is often stronger. Roomba still has advantages in retail familiarity, support, and some pet-focused navigation scenarios.",
      },
    ],
    shopperCta: {
      title: "Compare robot vacuum prices across the US",
      body: "See current offers on Roborock, Roomba, Shark, Ecovacs, and eufy in one BuyWhere search flow.",
      href: "/search?q=robot+vacuum&country=us",
      label: "Shop robot vacuums",
    },
    developerCta: {
      title: "Build appliance price comparison tools",
      body: "Use BuyWhere APIs to monitor price shifts, merchant coverage, and product availability for home appliances in real time.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: [
      { id: "r1", name: "Roborock S8 MaxV Ultra", price: 1299, currency: "USD", merchant: "Amazon", imageUrl: null, href: "/search?q=Roborock+S8+MaxV+Ultra&country=us", brand: "Roborock", category: "Robot Vacuums" },
      { id: "r2", name: "iRobot Roomba Combo j9+", price: 999, currency: "USD", merchant: "Best Buy", imageUrl: null, href: "/search?q=Roomba+Combo+j9%2B&country=us", brand: "iRobot", category: "Robot Vacuums" },
      { id: "r3", name: "Shark PowerDetect 2-in-1", price: 699, currency: "USD", merchant: "Walmart", imageUrl: null, href: "/search?q=Shark+PowerDetect+2-in-1&country=us", brand: "Shark", category: "Robot Vacuums" },
      { id: "r4", name: "Ecovacs Deebot X2 Omni", price: 1099, currency: "USD", merchant: "Amazon", imageUrl: null, href: "/search?q=Ecovacs+Deebot+X2+Omni&country=us", brand: "Ecovacs", category: "Robot Vacuums" },
      { id: "r5", name: "eufy X10 Pro Omni", price: 799, currency: "USD", merchant: "Amazon", imageUrl: null, href: "/search?q=eufy+X10+Pro+Omni&country=us", brand: "eufy", category: "Robot Vacuums" },
      { id: "r6", name: "Roborock Q5 Pro+", price: 499, currency: "USD", merchant: "Target", imageUrl: null, href: "/search?q=Roborock+Q5+Pro%2B&country=us", brand: "Roborock", category: "Robot Vacuums" },
    ],
  },
  "airpods-singapore": {
    slug: "airpods-singapore",
    title: "Best AirPods Deals in Singapore 2026 | Compare Prices Across SG Retailers",
    description:
      "Find the best AirPods deals in Singapore with live BuyWhere prices, retailer comparisons, and buying advice across Apple, Shopee, Lazada, Courts, and Challenger.",
    heroEyebrow: "Singapore Audio Guide",
    heroTitle: "Best AirPods Deals in Singapore",
    heroBody:
      "AirPods are among the most searched audio products in Singapore. This page combines the latest AirPods deals across Apple Store, Shopee, Lazada, and local electronics retailers with practical buying guidance so you can find the lowest real price.",
    canonicalPath: "/airpods-singapore",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "AirPods",
    refreshedLabel: "Updated May 4, 2026",
    productSectionTitle: "Live AirPods offers across Singapore",
    comparisonSectionTitle: "Popular AirPods picks at a glance",
    comparisonColumns: ["Model", "Price", "Battery", "ANC", "Best For"],
    comparisonRows: [
      { Model: "AirPods Pro 2", Price: "S$349", Battery: "6h", ANC: "Yes", "Best For": "Best overall" },
      { Model: "AirPods 4", Price: "S$199", Battery: "5h", ANC: "No", "Best For": "Best value" },
      { Model: "AirPods Max", Price: "S$699", Battery: "20h", ANC: "Yes", "Best For": "Best over-ear" },
    ],
    highlightSectionTitle: "What Singapore buyers check before buying",
    highlights: [
      {
        title: "Apple Store vs marketplace pricing",
        body: "Apple Store Official sells at fixed RRP. Shopee Mall and LazMall often undercut Apple pricing by 10-20% during campaign windows.",
      },
      {
        title: "Warranty matters for AirPods",
        body: "Verify the seller is an Apple Authorised Reseller. Non-authorised gray-market units may not be covered by Apple Singapore warranty.",
      },
      {
        title: "Campaign vouchers move prices",
        body: "5.5, 9.9, 11.11, and 12.12 usually deliver the lowest AirPods prices on Shopee and Lazada through stackable vouchers.",
      },
    ],
    adviceSectionTitle: "How to choose the right AirPods",
    advicePoints: [
      "For commuters and office workers, AirPods Pro 2 with ANC is the best everyday choice.",
      "If you do not need noise cancellation, AirPods 4 deliver solid audio at a lower price point.",
      "Check whether the listing includes international warranty or only local Apple Singapore coverage.",
      "Marketplace prices during 5.5, 9.9, and 11.11 can beat Apple Store by S$40 to S$80 or more.",
    ],
    faqSectionTitle: "AirPods Singapore FAQ",
    faqs: [
      {
        question: "Where is the cheapest place to buy AirPods in Singapore?",
        answer:
          "Shopee Mall and LazMall authorised resellers often have the lowest AirPods prices during campaign days (5.5, 9.9, 11.11). Apple Store is more consistent but rarely the cheapest.",
      },
      {
        question: "Is AirPods Pro 2 worth buying in 2026?",
        answer:
          "Yes. AirPods Pro 2 remains the best wireless earbuds for iPhone users in 2026 with excellent ANC, transparency mode, and tight Apple ecosystem integration.",
      },
      {
        question: "How do I verify AirPods are genuine in Singapore?",
        answer:
          "Buy from Apple Store, Apple Authorised Resellers, or verified Shopee Mall / LazMall stores. Avoid unbranded marketplace sellers at prices significantly below market.",
      },
    ],
    shopperCta: {
      title: "Compare AirPods prices in Singapore",
      body: "Find the lowest AirPods price across Apple Store, Shopee, Lazada, Courts, and Challenger in one search view.",
      href: "/search?q=AirPods&country=sg",
      label: "Shop AirPods",
    },
    developerCta: {
      title: "Build Singapore electronics price trackers",
      body: "Use BuyWhere APIs to monitor AirPods pricing and availability across SG retailers in real time.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: [
      { id: "ap1", name: "Apple AirPods Pro 2", price: 349, currency: "SGD", merchant: "Apple Store", imageUrl: null, href: "/search?q=AirPods+Pro+2&country=sg", brand: "Apple", category: "Audio" },
      { id: "ap2", name: "Apple AirPods 4", price: 199, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=AirPods+4&country=sg", brand: "Apple", category: "Audio" },
      { id: "ap3", name: "Apple AirPods Max", price: 699, currency: "SGD", merchant: "Lazada", imageUrl: null, href: "/search?q=AirPods+Max&country=sg", brand: "Apple", category: "Audio" },
      { id: "ap4", name: "Apple AirPods Pro 2", price: 339, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=AirPods+Pro+2&country=sg", brand: "Apple", category: "Audio" },
      { id: "ap5", name: "Apple AirPods 4", price: 189, currency: "SGD", merchant: "Courts", imageUrl: null, href: "/search?q=AirPods+4&country=sg", brand: "Apple", category: "Audio" },
    ],
  },
  "best-gaming-laptop-singapore": {
    slug: "best-gaming-laptop-singapore",
    title: "Best Gaming Laptops in Singapore 2026 | Compare RTX Gaming Laptop Deals",
    description:
      "Compare the best gaming laptops in Singapore with live BuyWhere search results, price benchmarks, and buying advice across ASUS ROG, Lenovo Legion, Alienware, HP Omen, and Acer Predator.",
    heroEyebrow: "Singapore Laptop Guide",
    heroTitle: "Best Gaming Laptops in Singapore",
    heroBody:
      "Gaming laptops in Singapore in 2026 handle competitive play, AAA releases, streaming, and creative workloads. This page combines editorial recommendations with live BuyWhere search results so you can compare specs and pricing across SG retailers in one view.",
    canonicalPath: "/best-gaming-laptop-singapore",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "gaming laptop",
    refreshedLabel: "Updated May 4, 2026",
    productSectionTitle: "Live gaming laptop deals across Singapore",
    comparisonSectionTitle: "Top gaming laptop picks at a glance",
    comparisonColumns: ["Model", "Price", "GPU", "CPU", "Best For"],
    comparisonRows: [
      { Model: "ASUS ROG Zephyrus G16", Price: "S$2,899", GPU: "RTX 5070", CPU: "Intel Core Ultra 9", "Best For": "Best overall" },
      { Model: "Lenovo Legion Pro 7i", Price: "S$3,299", GPU: "RTX 5080", CPU: "Intel Core Ultra 9", "Best For": "Best performance" },
      { Model: "HP Omen Transcend 14", Price: "S$2,499", GPU: "RTX 5070", CPU: "Intel Core Ultra 7", "Best For": "Best portable" },
      { Model: "Acer Predator Helios Neo 16", Price: "S$2,199", GPU: "RTX 5060", CPU: "Intel Core i9", "Best For": "Best value" },
      { Model: "ASUS TUF Gaming A15", Price: "S$1,799", GPU: "RTX 4060", CPU: "AMD Ryzen 9", "Best For": "Best under S$2,000" },
    ],
    highlightSectionTitle: "What Singapore buyers care about",
    highlights: [
      {
        title: "Local warranty and support matter",
        body: "Gaming laptops are expensive. Buy from authorised Singapore retailers with clear local warranty terms and service center access.",
      },
      {
        title: "Marketplace vouchers can move prices",
        body: "Shopee and Lazada gaming laptop listings during 5.5, 9.9, and 11.11 can beat Challenger or Courts pricing by S$200 to S$500 with stackable vouchers.",
      },
      {
        title: "Thermal performance matters in SG climate",
        body: "Singapore's ambient heat means cooling matters more than in temperate markets. Look for reviews that test sustained gaming in warm rooms.",
      },
    ],
    adviceSectionTitle: "How to choose a gaming laptop in Singapore",
    advicePoints: [
      "For most SG buyers, RTX 5060 and 5070-class laptops offer the best balance of price and enough performance for modern 1440p gaming.",
      "Check whether the listed price depends on stackable vouchers, bank card promos, or student discounts before checking out.",
      "For gaming laptops, 16GB RAM is the practical minimum and 32GB is better for buyers who stream or edit video.",
      "Best SG discount windows: 5.5, 6.6, 9.9, 11.11, 12.12, and GSS sales.",
    ],
    faqSectionTitle: "Gaming laptop Singapore FAQ",
    faqs: [
      {
        question: "What is the best gaming laptop in Singapore right now?",
        answer:
          "For most SG buyers, the ASUS ROG Zephyrus G16 offers the best balance of performance, build quality, portability, and local warranty support.",
      },
      {
        question: "Is RTX 4060 still good for gaming in 2026?",
        answer:
          "Yes. RTX 4060 gaming laptops are still a strong fit for 1080p gaming, esports titles, and many AAA games on high settings at sensible prices.",
      },
      {
        question: "Where is the cheapest place to buy a gaming laptop in Singapore?",
        answer:
          "Shopee and Lazada during campaign days often have the lowest prices. Challenger, Courts, and Harvey Norman are better for installment plans and in-store pickup.",
      },
    ],
    shopperCta: {
      title: "Compare gaming laptop prices in Singapore",
      body: "Find ASUS ROG, Lenovo Legion, Alienware, HP Omen, and Acer Predator deals across SG retailers in one search view.",
      href: "/search?q=gaming+laptop&country=sg",
      label: "Shop gaming laptops",
    },
    developerCta: {
      title: "Build gaming laptop price trackers",
      body: "Use BuyWhere APIs to monitor gaming laptop pricing, availability, and campaign deal swings across SG retailers.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: [
      { id: "g1", name: "ASUS ROG Zephyrus G16", price: 2899, currency: "SGD", merchant: "ASUS Singapore", imageUrl: null, href: "/search?q=ASUS+ROG+Zephyrus+G16&country=sg", brand: "ASUS", category: "Gaming Laptops" },
      { id: "g2", name: "Lenovo Legion Pro 7i", price: 3299, currency: "SGD", merchant: "Lenovo", imageUrl: null, href: "/search?q=Lenovo+Legion+Pro+7i&country=sg", brand: "Lenovo", category: "Gaming Laptops" },
      { id: "g3", name: "HP Omen Transcend 14", price: 2499, currency: "SGD", merchant: "HP", imageUrl: null, href: "/search?q=HP+Omen+Transcend+14&country=sg", brand: "HP", category: "Gaming Laptops" },
      { id: "g4", name: "Acer Predator Helios Neo 16", price: 2199, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=Acer+Predator+Helios+Neo+16&country=sg", brand: "Acer", category: "Gaming Laptops" },
      { id: "g5", name: "ASUS TUF Gaming A15", price: 1799, currency: "SGD", merchant: "Lazada", imageUrl: null, href: "/search?q=ASUS+TUF+Gaming+A15&country=sg", brand: "ASUS", category: "Gaming Laptops" },
    ],
  },
  "macbook-air-singapore": {
    slug: "macbook-air-singapore",
    title: "Cheapest MacBook Air in Singapore 2026 | Compare M3 & M4 Prices",
    description:
      "Find the cheapest MacBook Air in Singapore with live BuyWhere search results, retailer pricing benchmarks, and buying advice across Apple Store, Shopee, Lazada, and local retailers.",
    heroEyebrow: "Singapore Laptop Guide",
    heroTitle: "Cheapest MacBook Air in Singapore",
    heroBody:
      "MacBook Air remains the most popular ultraportable in Singapore for students, professionals, and everyday users. This page helps buyers find the lowest real price across Apple Store, authorised resellers, and marketplace campaigns.",
    canonicalPath: "/macbook-air-singapore",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "MacBook Air",
    refreshedLabel: "Updated May 4, 2026",
    productSectionTitle: "Live MacBook Air offers across Singapore",
    comparisonSectionTitle: "MacBook Air models at a glance",
    comparisonColumns: ["Model", "Price", "Chip", "RAM", "Best For"],
    comparisonRows: [
      { Model: "MacBook Air 13 M4", Price: "S$1,599", Chip: "Apple M4", RAM: "16GB", "Best For": "Best overall" },
      { Model: "MacBook Air 13 M3", Price: "S$1,499", Chip: "Apple M3", RAM: "16GB", "Best For": "Best value" },
      { Model: "MacBook Air 15 M4", Price: "S$1,899", Chip: "Apple M4", RAM: "16GB", "Best For": "Best large screen" },
    ],
    highlightSectionTitle: "Where to find the lowest price",
    highlights: [
      {
        title: "Apple Store vs authorised resellers",
        body: "Apple Store pricing is fixed but includes the cleanest warranty path. Shopee Mall and LazMall authorised resellers often undercut Apple by S$100 to S$200 during campaigns.",
      },
      {
        title: "Education pricing and student discounts",
        body: "Apple Education Store offers S$100 to S$150 off for students and educators. Some authorised resellers match education pricing year-round.",
      },
      {
        title: "Campaign timing matters",
        body: "5.5, 9.9, and 11.11 are the strongest discount windows for MacBook Air in Singapore through marketplace vouchers.",
      },
    ],
    adviceSectionTitle: "How to choose the right MacBook Air",
    advicePoints: [
      "For most buyers, the 13-inch M3 or M4 with 16GB RAM is the best everyday choice for studies, work, and travel.",
      "Choose the 15-inch model if you regularly work with large spreadsheets, presentations, or creative apps and want more screen.",
      "Verify the seller is an Apple Authorised Reseller before purchasing from a marketplace.",
      "Check whether the listing includes AppleCare+ or only standard warranty coverage.",
    ],
    faqSectionTitle: "MacBook Air Singapore FAQ",
    faqs: [
      {
        question: "What is the cheapest MacBook Air price in Singapore right now?",
        answer:
          "The MacBook Air 13 M3 starts from S$1,499 at Apple Store, but Shopee Mall and LazMall authorised resellers often list it from S$1,299 to S$1,399 during campaigns.",
      },
      {
        question: "Is MacBook Air or MacBook Pro better for Singapore users?",
        answer:
          "For most Singapore users (students, office work, browsing, media), MacBook Air is the better choice: lighter, fanless, cheaper, and powerful enough with M3/M4 chips.",
      },
      {
        question: "Should I buy MacBook Air from Shopee or Apple Store?",
        answer:
          "Apple Store gives you the cleanest purchase and warranty experience. Shopee Mall authorised resellers can save you S$100 to S$200 during campaigns but verify seller ratings carefully.",
      },
    ],
    shopperCta: {
      title: "Compare MacBook Air prices in Singapore",
      body: "Find the lowest MacBook Air price across Apple Store, Shopee, Lazada, Amazon.sg, and local electronics retailers.",
      href: "/search?q=MacBook+Air&country=sg",
      label: "Shop MacBook Air",
    },
    developerCta: {
      title: "Build Singapore laptop price trackers",
      body: "Use BuyWhere APIs to track MacBook Air pricing and availability across SG retailers in real time.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: [
      { id: "m1", name: "Apple MacBook Air 13 M4", price: 1599, currency: "SGD", merchant: "Apple Store", imageUrl: null, href: "/search?q=MacBook+Air+13+M4&country=sg", brand: "Apple", category: "Laptops" },
      { id: "m2", name: "Apple MacBook Air 13 M3", price: 1499, currency: "SGD", merchant: "Apple Store", imageUrl: null, href: "/search?q=MacBook+Air+13+M3&country=sg", brand: "Apple", category: "Laptops" },
      { id: "m3", name: "Apple MacBook Air 15 M4", price: 1899, currency: "SGD", merchant: "Apple Store", imageUrl: null, href: "/search?q=MacBook+Air+15+M4&country=sg", brand: "Apple", category: "Laptops" },
      { id: "m4", name: "Apple MacBook Air 13 M3", price: 1399, currency: "SGD", merchant: "Shopee", imageUrl: null, href: "/search?q=MacBook+Air+13+M3&country=sg", brand: "Apple", category: "Laptops" },
      { id: "m5", name: "Apple MacBook Air 13 M4", price: 1499, currency: "SGD", merchant: "Lazada", imageUrl: null, href: "/search?q=MacBook+Air+13+M4&country=sg", brand: "Apple", category: "Laptops" },
    ],
  },
};
