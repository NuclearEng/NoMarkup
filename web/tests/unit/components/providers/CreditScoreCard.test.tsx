import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreditScoreCard } from '@/components/providers/CreditScoreCard';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('@/hooks/useWorkingCapital', () => ({
  useCreditLimit: vi.fn(() => ({ data: null, isLoading: true })),
}));

const { useCreditLimit } = await import('@/hooks/useWorkingCapital');

describe('CreditScoreCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders skeletons in loading state', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useCreditLimit>);
    const { container } = render(<CreditScoreCard />);
    expect(screen.getByText('NoMarkup Credit Score')).toBeDefined();
    // Skeleton component renders a div with bg-muted; multiple in loading state
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('returns null when there is no credit limit', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    const { container } = render(<CreditScoreCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an A risk grade for low risk score', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 1000000,
        total_outstanding_cents: 100000,
        available_cents: 900000,
        risk_score: 0.2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    expect(screen.getByLabelText('Risk grade: A')).toBeDefined();
  });

  it('renders a D grade for high risk score', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 100000,
        total_outstanding_cents: 80000,
        available_cents: 20000,
        risk_score: 0.85,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    expect(screen.getByLabelText('Risk grade: D')).toBeDefined();
  });

  it('renders the credit utilization progressbar', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 1000000,
        total_outstanding_cents: 500000,
        available_cents: 500000,
        risk_score: 0.4,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('renders a B grade for moderate risk score', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 1000000,
        total_outstanding_cents: 400000,
        available_cents: 600000,
        risk_score: 0.4,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    expect(screen.getByLabelText('Risk grade: B')).toBeDefined();
  });

  it('renders a C grade for elevated risk score', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 1000000,
        total_outstanding_cents: 600000,
        available_cents: 400000,
        risk_score: 0.6,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    expect(screen.getByLabelText('Risk grade: C')).toBeDefined();
  });

  it('handles a zero advance limit without dividing by zero (shows a full, labeled bar)', () => {
    // No limit at all ($0 max, $0 available) is a fully-utilized state: the bar
    // must render FULL (100%) and clearly labeled, never a blank track that
    // reads as broken next to "$0 available".
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 0,
        total_outstanding_cents: 0,
        available_cents: 0,
        risk_score: 0.2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.style.width).toBe('100%');
    expect(bar.getAttribute('aria-label')).toMatch(/fully utilized/i);
  });

  it('shows a full, labeled bar when credit is fully utilized (0 available)', () => {
    // Limit reached: outstanding == max, $0 available.
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 500000,
        total_outstanding_cents: 500000,
        available_cents: 0,
        risk_score: 0.6,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    // The track is never left blank — width is the full 100%.
    expect(bar.style.width).toBe('100%');
    // Intuitive copy for the boundary state.
    expect(screen.getByText('Fully utilized')).toBeDefined();
    expect(screen.getByText('$0 available')).toBeDefined();
  });

  it('renders an improvement link to /provider/advances', () => {
    vi.mocked(useCreditLimit).mockReturnValue({
      data: {
        max_advance_cents: 1000000,
        total_outstanding_cents: 100000,
        available_cents: 900000,
        risk_score: 0.2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCreditLimit>);
    render(<CreditScoreCard />);
    const link = screen.getByText(/How to improve/);
    expect(link.getAttribute('href')).toBe('/provider/advances');
  });
});
