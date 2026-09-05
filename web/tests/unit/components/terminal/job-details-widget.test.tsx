import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { JobDetailsWidget } from '@/components/terminal/widgets/job-details-widget';
import type { WidgetProps } from '@/components/terminal/types';

function baseProps(overrides: Partial<WidgetProps> = {}): WidgetProps {
  return {
    sim: {
      bids: [],
      events: [],
      currentLowest: 0,
      previousLowest: undefined,
      orderBookBids: [],
      depthBuckets: [],
      activities: [],
      sparklineBids: [],
      velocity: 0,
      velocityBuckets: [0, 0, 0, 0, 0, 0],
      bidCount: 0,
      isRunning: false,
      showCelebration: false,
      setShowCelebration: () => undefined,
      start: () => undefined,
      pause: () => undefined,
      reset: () => undefined,
    },
    auctionEndsAt: new Date().toISOString(),
    startingPriceCents: 10_000,
    marketRange: { low_cents: 0, median_cents: 0, high_cents: 0, sample_size: 0 },
    mockProviders: [],
    ...overrides,
  };
}

describe('JobDetailsWidget', () => {
  it('renders real job title, description, and category', () => {
    render(
      <JobDetailsWidget
        {...baseProps({
          jobTitle: 'Replace water heater',
          jobDescription: '40-gal gas unit, same location.',
          jobCategory: 'Plumbing',
        })}
      />,
    );
    expect(screen.getByText('Replace water heater')).toBeInTheDocument();
    expect(screen.getByText(/40-gal gas unit/)).toBeInTheDocument();
    expect(screen.getByText('Plumbing')).toBeInTheDocument();
    expect(screen.queryByText(/kitchen renovation/i)).toBeNull();
  });

  it('shows honest empty copy when description is missing', () => {
    render(<JobDetailsWidget {...baseProps({ jobTitle: 'Untitled' })} />);
    expect(screen.getByText(/No description provided/i)).toBeInTheDocument();
  });
});
