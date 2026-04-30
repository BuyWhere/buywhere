export type AvailabilityStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'refresh_pending';

export interface RetailerPrice {
  retailer_id: string;
  retailer_name: string;
  retailer_logo_url: string;
  retailer_domain: string;
  region: 'SG' | 'US' | 'VN' | 'TH' | 'MY';
  price: number;
  price_formatted: string;
  original_price?: number;
  original_price_formatted?: string;
  availability: AvailabilityStatus;
  availability_label: string;
  url: string;
  affiliate_url?: string;
  shipping_note?: string;
  shipping_days?: number;
  delta_vs_lowest?: number;
}

export interface ProductSpec {
  label: string;
  value: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface RelatedComparison {
  slug: string;
  title: string;
  brand: string;
  lowest_price: number;
  lowest_price_formatted: string;
  image_url: string;
  retailer_count: number;
}

export interface ComparisonPageData {
  slug: string;
  product_id: string;
  category: 'electronics' | 'grocery' | 'home' | 'health';
  canonical_url: string;
  
  product: {
    id: string;
    title: string;
    brand: string;
    gtin?: string;
    description: string;
    image_url: string;
    category_path: string[];
    specs: ProductSpec[];
  };
  
  retailers: RetailerPrice[];
  lowest_price: number;
  lowest_price_formatted: string;
  lowest_price_retailer: string;
  
  expert_summary?: string;
  faq?: FAQItem[];
  
  related_comparisons: RelatedComparison[];
  
  metadata: {
    updated_at: string;
    published_at?: string;
  };
  
  breadcrumb: Array<{
    name: string;
    url: string;
  }>;
}

export type SortOption = 'price_low_to_high' | 'price_high_to_low' | 'availability';

export interface SEOMetadata {
  title: string;
  description: string;
  canonical_url: string;
  og_title: string;
  og_description: string;
  og_image: string;
  twitter_title: string;
  twitter_description: string;
  twitter_image: string;
}