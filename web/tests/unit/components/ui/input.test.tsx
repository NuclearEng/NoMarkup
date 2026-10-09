import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Input } from '@/components/ui/input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="Email" />);
    expect(screen.getByPlaceholderText('Email')).toBeDefined();
  });

  it('forwards className', () => {
    render(<Input className="custom-input" data-testid="i" />);
    expect(screen.getByTestId('i').className).toContain('custom-input');
  });

  it('calls onChange when user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input onChange={onChange} placeholder="t" />);
    await user.type(screen.getByPlaceholderText('t'), 'abc');
    expect(onChange).toHaveBeenCalled();
  });

  it('honors the disabled attribute', () => {
    render(<Input disabled placeholder="d" />);
    expect(screen.getByPlaceholderText<HTMLInputElement>('d').disabled).toBe(true);
  });

  it('applies the glass variant', () => {
    render(<Input variant="glass" placeholder="g" />);
    expect(screen.getByPlaceholderText('g').className).toContain('glass-input');
  });
});
