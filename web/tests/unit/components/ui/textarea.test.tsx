import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Textarea } from '@/components/ui/textarea';

describe('Textarea', () => {
  it('renders a textarea', () => {
    render(<Textarea placeholder="Body" />);
    expect(screen.getByPlaceholderText('Body')).toBeDefined();
  });

  it('forwards className', () => {
    render(<Textarea className="custom-ta" placeholder="x" />);
    expect(screen.getByPlaceholderText('x').className).toContain('custom-ta');
  });

  it('fires onChange when typed in', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} placeholder="t" />);
    await user.type(screen.getByPlaceholderText('t'), 'hi');
    expect(onChange).toHaveBeenCalled();
  });

  it('honors the disabled attribute', () => {
    render(<Textarea disabled placeholder="d" />);
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('d').disabled).toBe(true);
  });
});
