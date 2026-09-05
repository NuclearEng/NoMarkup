import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreditScoreCard } from '@/components/providers/CreditScoreCard';

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

  it('does NOT route the improve-score control to the working-capital / advances page', () => {
    // Regression (ISSUE: credit-score "how to improve" link): the trigger used
    // to be a <Link href="/provider/advances">, dumping the user on the
    // working-capital page instead of explaining how to improve the score. It is
    // now a dialog trigger (a button), and nothing here links to advances.
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

    const trigger = screen.getByRole('button', { name: /how to improve your score/i });
    // A button, not a navigation link — no href at all.
    expect(trigger.getAttribute('href')).toBeNull();

    const advancesLinks = screen
      .queryAllByRole('link')
      .filter((el) => el.getAttribute('href')?.includes('advances'));
    expect(advancesLinks).toHaveLength(0);
  });

  it('opens an explainer dialog describing the real score factors', async () => {
    const user = userEvent.setup();
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

    // Dialog content is not mounted until the trigger is activated.
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /how to improve your score/i }));

    const dialog = screen.getByRole('dialog');
    // Factors must match the gateway businessCreditScore() model
    // (gateway/internal/handler/advance_pricing.go) — repayment 50%, jobs 30%,
    // earnings 20% — not invented advice.
    // Match the exact factor headings — the descriptions also mention these
    // phrases, so a fuzzy /completed jobs/i would match multiple nodes.
    expect(within(dialog).getByText('Repayment history')).toBeDefined();
    expect(within(dialog).getByText('Completed jobs')).toBeDefined();
    expect(within(dialog).getByText('Total earnings')).toBeDefined();
    expect(within(dialog).getByText(/up to 50%/i)).toBeDefined();
    expect(within(dialog).getByText(/up to 30%/i)).toBeDefined();
    expect(within(dialog).getByText(/up to 20%/i)).toBeDefined();

    // The explainer must not send the user to the advances page.
    const dialogAdvancesLinks = within(dialog)
      .queryAllByRole('link')
      .filter((el) => el.getAttribute('href')?.includes('advances'));
    expect(dialogAdvancesLinks).toHaveLength(0);
  });
});
