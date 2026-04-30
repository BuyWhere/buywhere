import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProductCard, { ProductCardSkeleton } from '../ProductCardCompare';
import { RetailerPrice } from '@/types/compare';

const mockProduct = {
  image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80',
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
};

const mockRetailer: RetailerPrice = {
  retailer_id: 'lazada-sg',
  retailer_name: 'Lazada',
  retailer_logo_url: 'https://lazada.com/logo.png',
  retailer_domain: 'lazada.sg',
  region: 'SG',
  price: 329.0,
  price_formatted: 'S$329.00',
  original_price: 399.0,
  original_price_formatted: 'S$399.00',
  availability: 'in_stock',
  availability_label: 'In stock',
  url: 'https://lazada.sg/product/sony-wh1000xm5',
  affiliate_url: 'https://affiliate.lazada.sg/product/sony-wh1000xm5',
  shipping_note: 'Free delivery by tomorrow',
  shipping_days: 1,
};

describe('ProductCardCompare', () => {
  it('renders product title', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    expect(screen.getByText('Sony WH-1000XM5 Wireless Noise Cancelling Headphones')).toBeInTheDocument();
  });

  it('renders price', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    expect(screen.getByText('S$329.00')).toBeInTheDocument();
  });

  it('renders retailer name', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    expect(screen.getByText('Lazada')).toBeInTheDocument();
  });

  it('renders CTA link', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    const link = screen.getByRole('link', { name: /Buy Sony WH-1000XM5 Wireless Noise Cancelling Headphones from Lazada/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://affiliate.lazada.sg/product/sony-wh1000xm5');
  });

  it('shows best price badge when isLowestPrice is true', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} isLowestPrice={true} />);
    expect(screen.getByText('Best price')).toBeInTheDocument();
  });

  it('shows original price when available', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    expect(screen.getByText('S$399.00')).toBeInTheDocument();
  });

  it('shows shipping note when available', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    expect(screen.getByText('Free delivery by tomorrow')).toBeInTheDocument();
  });

  it('shows in stock badge', () => {
    render(<ProductCard product={mockProduct} retailer={mockRetailer} />);
    expect(screen.getByText('In stock')).toBeInTheDocument();
  });

  it('shows out of stock badge when out of stock', () => {
    const outOfStockRetailer: RetailerPrice = {
      ...mockRetailer,
      availability: 'out_of_stock',
      availability_label: 'Out of stock',
    };
    render(<ProductCard product={mockProduct} retailer={outOfStockRetailer} />);
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });
});

describe('ProductCardSkeleton', () => {
  it('renders skeleton component', () => {
    render(<ProductCardSkeleton />);
    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();
  });
});
