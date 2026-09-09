import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders with default size', () => {
    render(<Spinner />);
    const spinner = screen.getByRole('status');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass(/md/);
  });

  it('renders with correct size classes', () => {
    const { rerender } = render(<Spinner size="sm" />);
    expect(screen.getByRole('status')).toHaveClass(/sm/);

    rerender(<Spinner size="md" />);
    expect(screen.getByRole('status')).toHaveClass(/md/);

    rerender(<Spinner size="lg" />);
    expect(screen.getByRole('status')).toHaveClass(/lg/);
  });

  it('uses default loading label', () => {
    render(<Spinner />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('uses custom label', () => {
    render(<Spinner label="Processing your request" />);
    expect(screen.getByText('Processing your request')).toBeInTheDocument();
  });

  it('has aria-label attribute', () => {
    render(<Spinner label="Custom label" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Custom label');
  });

  it('applies custom className', () => {
    render(<Spinner className="custom-spinner" />);
    expect(screen.getByRole('status')).toHaveClass('custom-spinner');
  });
});