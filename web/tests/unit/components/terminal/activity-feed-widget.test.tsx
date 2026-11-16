// ActivityFeedWidget — wraps BidActivityFeed. Smoke-test the header and
// activity forwarding.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bids/BidActivityFeed', () => ({
  BidActivityFeed: ({ activities }: { activities: { id: string }[] }) =>
    createElement('div', { 'data-testid': 'activity-feed' }, `n:${String(activities.length)}`),
}));

import { ActivityFeedWidget } from '@/components/terminal/widgets/activity-feed-widget';
import { makeWidgetProps } from './_fixtures';

describe('ActivityFeedWidget', () => {
  it('renders Live Activity header', () => {
    render(createElement(ActivityFeedWidget, makeWidgetProps()));
    expect(screen.getByText('Live Activity')).toBeDefined();
  });

  it('forwards activities to BidActivityFeed', () => {
    render(createElement(ActivityFeedWidget, makeWidgetProps()));
    expect(screen.getByTestId('activity-feed').textContent).toBe('n:1');
  });

  it('shows the Live indicator', () => {
    render(createElement(ActivityFeedWidget, makeWidgetProps()));
    expect(screen.getByText('Live')).toBeDefined();
  });
});
