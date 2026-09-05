import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from '@/components/ui/switch';

describe('Switch', () => {
  it('renders a switch control', () => {
    render(<Switch aria-label="notifications" />);
    expect(screen.getByRole('switch', { name: 'notifications' })).toBeDefined();
  });

  it('toggles state on click and fires onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="t" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('forwards className', () => {
    render(<Switch aria-label="x" className="my-switch" />);
    expect(screen.getByRole('switch').className).toContain('my-switch');
  });

  it('respects the disabled prop', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="d" disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('exposes a min 44px hit target (FE-07)', () => {
    render(<Switch aria-label="agree" />);
    const el = screen.getByRole('switch', { name: 'agree' });
    expect(el.className).toMatch(/min-h-11/);
    expect(el.className).toMatch(/min-w-11/);
  });
});
