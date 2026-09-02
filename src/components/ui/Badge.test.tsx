import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders with correct text', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByRole('status')).toHaveTextContent('New');
  });

  it('applies new variant by default', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByRole('status')).toHaveClass(/new/);
  });

  it('applies sale variant', () => {
    render(<Badge variant="sale">50% Off</Badge>);
    expect(screen.getByRole('status')).toHaveClass(/sale/);
  });

  it('applies out-of-stock variant', () => {
    render(<Badge variant="out-of-stock">Sold Out</Badge>);
    expect(screen.getByRole('status')).toHaveClass(/outOfStock/);
  });

  it('applies custom className', () => {
    render(<Badge className="custom-badge">Badge</Badge>);
    expect(screen.getByRole('status')).toHaveClass('custom-badge');
  });

  it('has role="status" for accessibility', () => {
    render(<Badge>Test Badge</Badge>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});