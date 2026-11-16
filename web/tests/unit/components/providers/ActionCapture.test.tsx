import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionCapture } from '@/components/providers/ActionCapture';
import { Button } from '@/components/ui/button';
import {
  __resetClientActionsForTests,
  listClientActions,
} from '@/lib/client-action-log';

vi.mock('next/navigation', () => ({
  usePathname: () => '/login',
}));

describe('ActionCapture', () => {
  afterEach(() => {
    __resetClientActionsForTests();
  });

  it('records a screen hop on mount and a TAP for a button click', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ActionCapture />
        <Button>Sign in</Button>
      </>,
    );
    expect(listClientActions().some((e) => e.kind === 'screen' && e.path === '/login')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const taps = listClientActions().filter((e) => e.kind === 'ui' && e.method === 'TAP');
    expect(taps.length).toBeGreaterThan(0);
    expect(taps[0]?.path).toMatch(/Sign in/i);
  });

  it('does not record keystrokes in inputs', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ActionCapture />
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" />
      </>,
    );
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    expect(listClientActions().some((e) => e.path.includes('Password123'))).toBe(false);
  });
});
