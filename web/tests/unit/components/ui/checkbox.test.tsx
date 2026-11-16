import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from '@/components/ui/checkbox';

describe('Checkbox', () => {
  it('renders unchecked by default', () => {
    render(<Checkbox aria-label="agree" />);
    expect(screen.getByRole('checkbox', { name: 'agree' }).getAttribute('data-state')).toBe(
      'unchecked',
    );
  });

  it('toggles on click and fires onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="agree" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('forwards className', () => {
    render(<Checkbox aria-label="c" className="my-check" />);
    expect(screen.getByRole('checkbox').className).toContain('my-check');
  });

  it('exposes a min 44px hit target (FE-07)', () => {
    render(<Checkbox aria-label="agree" />);
    const el = screen.getByRole('checkbox', { name: 'agree' });
    expect(el.className).toMatch(/min-h-11/);
    expect(el.className).toMatch(/min-w-11/);
  });

  it('respects the disabled prop', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="c" disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
