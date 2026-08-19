export interface TaxonomyCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  regions: ('us' | 'sg' | 'sea')[];
}

export const PRODUCT_TAXONOMY: TaxonomyCategory[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    slug: 'electronics',
    description: 'Compare prices on gadgets, laptops, phones, and more',
    icon: '📱',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'fashion',
    name: 'Fashion',
    slug: 'fashion',
    description: 'Find the best deals on clothing, shoes, and accessories',
    icon: '👕',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'home-living',
    name: 'Home & Living',
    slug: 'home-living',
    description: 'Compare prices on furniture, decor, and home essentials',
    icon: '🏠',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'beauty',
    name: 'Beauty',
    slug: 'beauty',
    description: 'Discover beauty products across top retailers',
    icon: '💄',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'sports-outdoors',
    name: 'Sports & Outdoors',
    slug: 'sports-outdoors',
    description: 'Fitness gear, outdoor equipment, and sporting goods',
    icon: '⚽',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'health-wellness',
    name: 'Health & Wellness',
    slug: 'health-wellness',
    description: 'Vitamins, supplements, and wellness products',
    icon: '💊',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'toys-games',
    name: 'Toys & Games',
    slug: 'toys-games',
    description: 'Toys, board games, and entertainment for all ages',
    icon: '🎮',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'food-beverages',
    name: 'Food & Beverages',
    slug: 'food-beverages',
    description: 'Gourmet foods, snacks, and beverages',
    icon: '🍫',
    regions: ['sg', 'sea'],
  },
  {
    id: 'automotive',
    name: 'Automotive',
    slug: 'automotive',
    description: 'Car accessories, parts, and automotive tools',
    icon: '🚗',
    regions: ['us', 'sg', 'sea'],
  },
  {
    id: 'pet-supplies',
    name: 'Pet Supplies',
    slug: 'pet-supplies',
    description: 'Pet food, toys, and care products',
    icon: '🐕',
    regions: ['us', 'sg', 'sea'],
  },
];

export const US_CATEGORY_META: Record<string, { name: string; slug: string; description: string; breadcrumbs: { name: string; href?: string }[] }> = {
  electronics: {
    name: 'Electronics',
    slug: 'electronics',
    description: 'Compare prices on the latest electronics from Amazon, Walmart, Target, and Best Buy. Find the best deals on gadgets, computers, TVs, and more.',
    breadcrumbs: [
      { name: 'Home', href: '/' },
      { name: 'Categories', href: '/categories' },
      { name: 'Electronics' },
    ],
  },
  'home-living': {
    name: 'Home & Living',
    slug: 'home-living',
    description: 'Compare prices on home goods, furniture, and living essentials from Amazon, Walmart, Target, and more.',
    breadcrumbs: [
      { name: 'Home', href: '/' },
      { name: 'Categories', href: '/categories' },
      { name: 'Home & Living' },
    ],
  },
  fashion: {
    name: 'Fashion',
    slug: 'fashion',
    description: 'Compare prices on clothing, shoes, and accessories from Amazon, Walmart, Target, and more.',
    breadcrumbs: [
      { name: 'Home', href: '/' },
      { name: 'Categories', href: '/categories' },
      { name: 'Fashion' },
    ],
  },
  beauty: {
    name: 'Beauty',
    slug: 'beauty',
    description: 'Compare prices on beauty products, skincare, makeup, and more from top retailers.',
    breadcrumbs: [
      { name: 'Home', href: '/' },
      { name: 'Categories', href: '/categories' },
      { name: 'Beauty' },
    ],
  },
  'sports-outdoors': {
    name: 'Sports & Outdoors',
    slug: 'sports-outdoors',
    description: 'Compare prices on sports equipment, outdoor gear, and fitness products.',
    breadcrumbs: [
      { name: 'Home', href: '/' },
      { name: 'Categories', href: '/categories' },
      { name: 'Sports & Outdoors' },
    ],
  },
  'toys-games': {
    name: 'Toys & Games',
    slug: 'toys-games',
    description: 'Compare prices on toys, games, and entertainment for kids of all ages.',
    breadcrumbs: [
      { name: 'Home', href: '/' },
      { name: 'Categories', href: '/categories' },
      { name: 'Toys & Games' },
    ],
  },
};

export function getCategoryBySlug(slug: string): TaxonomyCategory | undefined {
  return PRODUCT_TAXONOMY.find((cat) => cat.slug === slug);
}

export function getUSCategoryMeta(slug: string): typeof US_CATEGORY_META[string] | undefined {
  return US_CATEGORY_META[slug];
}