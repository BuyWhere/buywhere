import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import ProductCard from '../components/ProductCardCompare';
import { RetailerPrice } from '@/types/compare';

const mockProduct = {
  image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80',
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
};

const meta = {
  title: 'Components/ProductCardCompare',
  component: ProductCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof ProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockRetailerLazada: RetailerPrice = {
  retailer_id: 'lazada-sg',
  retailer_name: 'Lazada',
  retailer_logo_url: 'https://lazada.com/logo.png',
  retailer_domain: 'lazada.sg',
  region: 'SG',
  price: 329.00,
  price_formatted: 'S$329.00',
  original_price: 399.00,
  original_price_formatted: 'S$399.00',
  availability: 'in_stock',
  availability_label: 'In stock',
  url: 'https://lazada.sg/product/sony-wh1000xm5',
  affiliate_url: 'https://affiliate.lazada.sg/product/sony-wh1000xm5',
  shipping_note: 'Free delivery by tomorrow',
  shipping_days: 1,
};

const mockRetailerShopee: RetailerPrice = {
  retailer_id: 'shopee-sg',
  retailer_name: 'Shopee',
  retailer_logo_url: 'https://shopee.com/logo.png',
  retailer_domain: 'shopee.sg',
  region: 'SG',
  price: 349.00,
  price_formatted: 'S$349.00',
  availability: 'in_stock',
  availability_label: 'In stock',
  url: 'https://shopee.sg/product/sony-wh1000xm5',
  shipping_note: 'Ships in 2-3 days',
  shipping_days: 3,
};

const mockRetailerAmazon: RetailerPrice = {
  retailer_id: 'amazon-sg',
  retailer_name: 'Amazon',
  retailer_logo_url: 'https://amazon.com/logo.png',
  retailer_domain: 'amazon.sg',
  region: 'US',
  price: 299.00,
  price_formatted: 'US$299.00',
  original_price: 349.00,
  original_price_formatted: 'US$349.00',
  availability: 'low_stock',
  availability_label: 'Low stock',
  url: 'https://amazon.sg/product/sony-wh1000xm5',
  shipping_note: 'International shipping available',
  shipping_days: 7,
};

const mockRetailerOutOfStock: RetailerPrice = {
  retailer_id: 'courts-sg',
  retailer_name: 'Courts',
  retailer_logo_url: 'https://courts.com.sg/logo.png',
  retailer_domain: 'courts.com.sg',
  region: 'SG',
  price: 319.00,
  price_formatted: 'S$319.00',
  availability: 'out_of_stock',
  availability_label: 'Out of stock',
  url: 'https://courts.com.sg/product/sony-wh1000xm5',
  shipping_note: 'Not available',
};

export const Default: Story = {
  args: {
    product: mockProduct,
    retailer: mockRetailerLazada,
    isLowestPrice: false,
  },
};

export const BestPrice: Story = {
  args: {
    product: mockProduct,
    retailer: mockRetailerLazada,
    isLowestPrice: true,
  },
};

export const ShopeeOffer: Story = {
  args: {
    product: mockProduct,
    retailer: mockRetailerShopee,
    isLowestPrice: false,
  },
};

export const AmazonInternational: Story = {
  args: {
    product: mockProduct,
    retailer: mockRetailerAmazon,
    isLowestPrice: false,
  },
};

export const OutOfStock: Story = {
  args: {
    product: mockProduct,
    retailer: mockRetailerOutOfStock,
    isLowestPrice: false,
  },
};