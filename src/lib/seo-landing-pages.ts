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
        name: config.heroTitle,
        description: config.description,
        url: canonical,
        isPartOf: {
          "@type": "WebSite",
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
};
