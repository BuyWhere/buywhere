import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './Input';

describe('Input', () => {
  it('renders with default size', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveClass(/md/);
  });

  it('renders with correct size classes', () => {
    const { rerender } = render(<Input inputSize="sm" />);
    expect(screen.getByRole('textbox')).toHaveClass(/sm/);

    rerender(<Input inputSize="md" />);
    expect(screen.getByRole('textbox')).toHaveClass(/md/);

    rerender(<Input inputSize="lg" />);
    expect(screen.getByRole('textbox')).toHaveClass(/lg/);
  });

  it('renders with label', () => {
    render(<Input label="Email Address" />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('renders with helper text', () => {
    render(<Input helperText="Enter your email" />);
    expect(screen.getByText(/enter your email/i)).toBeInTheDocument();
  });

  it('renders with error message', () => {
    render(<Input error="This field is required" />);
    expect(screen.getByRole('alert')).toHaveText(/this field is required/i);
  });

  it('shows error state with aria-invalid', () => {
    render(<Input error="Error message" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('associates error with input via aria-describedby', () => {
    render(<Input error="Error message" label="Test Input" />);
    const input = screen.getByLabelText(/test input/i);
    expect(input).toHaveAttribute('aria-describedby');
  });

  it('handles text input', async () => {
    const user = userEvent.setup();
    render(<Input />);
    const input = screen.getByRole('textbox');
    
    await user.type(input, 'Hello World');
    expect(input).toHaveValue('Hello World');
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('forwards additional props', () => {
    render(<Input name="email" type="email" placeholder="Enter email" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('name', 'email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('placeholder', 'Enter email');
  });

  it('applies fullWidth class when specified', () => {
    render(<Input fullWidth />);
    expect(screen.getByRole('textbox').parentElement).toHaveClass(/fullWidth/);
  });

  it('does not render helper text when error is present', () => {
    render(<Input helperText="Helper" error="Error" />);
    expect(screen.queryByText(/helper/i)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

import React from 'react';