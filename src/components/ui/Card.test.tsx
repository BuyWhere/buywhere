import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardBody, CardFooter } from './Card';

describe('Card', () => {
  it('renders as a div by default', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText(/card content/i)).toBeInTheDocument();
  });

  it('renders as custom element when as prop is provided', () => {
    render(<Card as="article">Article card</Card>);
    expect(screen.getByText(/article card/i).tagName).toBe('ARTICLE');
  });

  it('renders with CardHeader, CardBody, and CardFooter', () => {
    render(
      <Card>
        <CardHeader>Header</CardHeader>
        <CardBody>Body content</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText(/header/i)).toBeInTheDocument();
    expect(screen.getByText(/body content/i)).toBeInTheDocument();
    expect(screen.getByText(/footer/i)).toBeInTheDocument();
  });

  it('CardHeader renders action slot', () => {
    render(
      <Card>
        <CardHeader action={<button>Action</button>}>Title</CardHeader>
      </Card>
    );
    expect(screen.getByRole('button', { name: /action/i })).toBeInTheDocument();
  });

  it('applies custom className to Card', () => {
    render(<Card className="custom-card">Content</Card>);
    expect(screen.getByText(/content/i).parentElement).toHaveClass('custom-card');
  });

  it('applies custom className to CardHeader', () => {
    render(
      <Card>
        <CardHeader className="custom-header">Title</CardHeader>
      </Card>
    );
    expect(screen.getByText(/title/i).parentElement).toHaveClass('custom-header');
  });

  it('applies custom className to CardBody', () => {
    render(
      <Card>
        <CardBody className="custom-body">Body</CardBody>
      </Card>
    );
    expect(screen.getByText(/body/i)).toHaveClass('custom-body');
  });

  it('applies custom className to CardFooter', () => {
    render(
      <Card>
        <CardFooter className="custom-footer">Footer</CardFooter>
      </Card>
    );
    expect(screen.getByText(/footer/i)).toHaveClass('custom-footer');
  });
});