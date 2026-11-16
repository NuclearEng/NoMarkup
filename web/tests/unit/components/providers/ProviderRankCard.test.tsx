import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderRankCard } from '@/components/providers/ProviderRankCard';

vi.mock('@/hooks/useBids', () => ({
  useProviderStreaks: vi.fn(() => ({ data: undefined, isLoading: true })),
}));

const { useProviderStreaks } = await import('@/hooks/useBids');

describe('ProviderRankCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders skeleton placeholders when loading', () => {
    vi.mocked(useProviderStreaks).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useProviderStreaks>);
    render(<ProviderRankCard />);
    expect(screen.getByRole('status', { name: 'Loading win stats' })).toBeDefined();
  });

  it('returns null when no streaks data', () => {
    vi.mocked(useProviderStreaks).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useProviderStreaks>);
    const { container } = render(<ProviderRankCard />);
    expect(container.firstChild).toBeNull();
  });

  it('aggregates total wins across categories', () => {
    vi.mocked(useProviderStreaks).mockReturnValue({
      data: [
        { category_id: 'a', total_wins: 5, current_streak: 2, longest_streak: 4, category_rank: 3 },
        { category_id: 'b', total_wins: 7, current_streak: 1, longest_streak: 5, category_rank: 1 },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useProviderStreaks>);
    render(<ProviderRankCard />);
    expect(screen.getByText('Win Stats')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined(); // 5 + 7
    expect(screen.getByText('Total Wins')).toBeDefined();
  });

  it('shows the best (lowest) category rank with a # prefix', () => {
    vi.mocked(useProviderStreaks).mockReturnValue({
      data: [
        { category_id: 'a', total_wins: 5, current_streak: 2, longest_streak: 4, category_rank: 3 },
        { category_id: 'b', total_wins: 7, current_streak: 1, longest_streak: 5, category_rank: 1 },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useProviderStreaks>);
    render(<ProviderRankCard />);
    expect(screen.getByText('#1')).toBeDefined();
  });

  it('shows em dash when no category is ranked', () => {
    vi.mocked(useProviderStreaks).mockReturnValue({
      data: [
        { category_id: 'a', total_wins: 1, current_streak: 0, longest_streak: 1, category_rank: null },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useProviderStreaks>);
    render(<ProviderRankCard />);
    expect(screen.getByText('—')).toBeDefined();
  });
});
