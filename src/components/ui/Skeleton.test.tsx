import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonText } from './Skeleton';

describe('Skeleton', () => {
  it('renders with text variant by default', () => {
    render(<Skeleton />);
    const skeleton = screen.getByLabelText ? screen.queryByLabelText(/loading/i) : screen.queryByText('');
    expect(skeleton).toBeInTheDocument();
  });

  it('applies text variant', () => {
    render(<Skeleton variant="text" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass(/text/);
  });

  it('applies circular variant', () => {
    render(<Skeleton variant="circular" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass(/circular/);
  });

  it('applies rectangular variant', () => {
    render(<Skeleton variant="rectangular" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass(/rectangular/);
  });

  it('applies custom width', () => {
    render(<Skeleton width="200px" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveStyle({ width: '200px' });
  });

  it('applies custom height', () => {
    render(<Skeleton height={50} />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveStyle({ height: '50px' });
  });

  it('applies custom className', () => {
    render(<Skeleton className="custom-skeleton" />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass('custom-skeleton');
  });

  it('has aria-hidden to hide from screen readers', () => {
    render(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('SkeletonText', () => {
  it('renders default 3 lines', () => {
    render(<SkeletonText />);
    const skeletons = document.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons).toHaveLength(3);
  });

  it('renders specified number of lines', () => {
    render(<SkeletonText lines={5} />);
    const skeletons = document.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons).toHaveLength(5);
  });

  it('last line is shorter', () => {
    render(<SkeletonText lines={3} />);
    const skeletons = document.querySelectorAll('[aria-hidden="true"]');
    const lastSkeleton = skeletons[skeletons.length - 1];
    expect(lastSkeleton).toHaveStyle({ width: '60%' });
  });

  it('applies custom className', () => {
    render(<SkeletonText className="custom-text-skeleton" />);
    const wrapper = document.querySelector('[aria-label="Loading text"]');
    expect(wrapper).toHaveClass('custom-text-skeleton');
  });
});