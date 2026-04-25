import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceCountdown } from '@/components/contracts/AcceptanceCountdown';

describe('AcceptanceCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows expired state for past deadlines', () => {
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-23T00:00:00Z' }));
    expect(screen.getByText('Deadline Expired')).toBeDefined();
  });

  it('renders countdown for future deadline (full layout)', () => {
    // 2 days, 3 hours later
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-26T15:00:00Z' }));
    expect(screen.getByLabelText('Acceptance deadline countdown')).toBeDefined();
    expect(screen.getByText(/Acceptance Deadline/i)).toBeDefined();
  });

  it('renders compact view with "to accept" text', () => {
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-26T15:00:00Z', compact: true }));
    expect(screen.getByLabelText('Acceptance deadline')).toBeDefined();
    expect(screen.getByText(/to accept/)).toBeDefined();
  });

  it('expired state in compact mode also shows Deadline Expired', () => {
    render(createElement(AcceptanceCountdown, { deadline: '2026-04-23T00:00:00Z', compact: true }));
    expect(screen.getByText('Deadline Expired')).toBeDefined();
  });
});
