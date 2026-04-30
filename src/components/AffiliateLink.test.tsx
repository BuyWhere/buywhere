import { render, screen, fireEvent } from '@testing-library/react';
import { AffiliateLink } from './AffiliateLink';

// Mock navigator.sendBeacon
const mockSendBeacon = jest.fn();
Object.defineProperty(navigator, 'sendBeacon', {
  value: mockSendBeacon,
  writable: true,
});

describe('AffiliateLink', () => {
  beforeEach(() => {
    mockSendBeacon.mockClear();
  });

  it('renders as an anchor tag with correct href', () => {
    render(<AffiliateLink productId="123" platform="shopee_sg" href="https://shopee.sg/product/123">Test Link</AffiliateLink>);
    
    const link = screen.getByRole('link', { name: /test link/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://shopee.sg/product/123');
  });

  it('adds UTM parameters to href', () => {
    render(<AffiliateLink productId="123" platform="shopee_sg" href="https://shopee.sg/product/123">Test Link</AffiliateLink>);
    
    const link = screen.getByRole('link', { name: /test link/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('utm_source=buywhere'));
    expect(link).toHaveAttribute('href', expect.stringContaining('utm_medium=affiliate'));
    expect(link).toHaveAttribute('href', expect.stringContaining('utm_campaign=catalog'));
  });

  it('sends tracking data on click', () => {
    render(<AffiliateLink productId="123" platform="shopee_sg" href="https://shopee.sg/product/123">Test Link</AffiliateLink>);
    
    const link = screen.getByRole('link', { name: /test link/i });
    fireEvent.click(link);
    
    expect(mockSendBeacon).toHaveBeenCalled();
    // Check that it was called with the correct endpoint and data
    expect(mockSendBeacon).toHaveBeenCalledWith(
      '/api/track-click',
      expect.stringContaining('product_id')
    );
  });

  it('handles missing href gracefully', () => {
    render(<AffiliateLink productId="123" platform="shopee_sg">Test Link</AffiliateLink>);
    
    const link = screen.getByRole('link', { name: /test link/i });
    expect(link).toHaveAttribute('href', '#');
  });

  it('allows custom target and rel attributes', () => {
    render(<AffiliateLink productId="123" platform="shopee_sg" href="https://example.com" target="_self" rel="nofollow">Test Link</AffiliateLink>);
    
    const link = screen.getByRole('link', { name: /test link/i });
    expect(link).toHaveAttribute('target', '_self');
    expect(link).toHaveAttribute('rel', 'nofollow');
  });
});