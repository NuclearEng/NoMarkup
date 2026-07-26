import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SupportContactForm } from '@/components/compliance/SupportContactForm';

describe('SupportContactForm', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('opens mailto with prefilled subject and body', async () => {
    const user = userEvent.setup();
    render(<SupportContactForm />);

    await user.type(screen.getByLabelText(/Name/i), 'Ada');
    await user.type(screen.getByLabelText(/Your email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^Subject/i), 'Need help');
    await user.type(screen.getByLabelText(/^Message/i), 'Cannot export data');
    await user.click(screen.getByRole('button', { name: /Open email to support/i }));

    expect(window.location.href).toMatch(/^mailto:support@no-markup\.com\?/);
    expect(window.location.href).toContain(encodeURIComponent('Need help'));
    expect(window.location.href).toContain(encodeURIComponent('Ada'));
    expect(window.location.href).toContain(encodeURIComponent('ada@example.com'));
    expect(window.location.href).toContain(encodeURIComponent('Cannot export data'));
  });

  it('renders form test id', () => {
    render(<SupportContactForm />);
    expect(screen.getByTestId('support-contact-form')).toBeDefined();
  });
});
