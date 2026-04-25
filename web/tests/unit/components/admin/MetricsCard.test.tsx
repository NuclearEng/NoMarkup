import { render, screen } from '@testing-library/react';
import { TrendingUp } from 'lucide-react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MetricsCard } from '@/components/admin/MetricsCard';

vi.mock('@/hooks/useCountUp', () => ({
  useCountUp: (target: number) => target,
}));

describe('MetricsCard', () => {
  it('renders label and value', () => {
    render(createElement(MetricsCard, { label: 'Active Users', value: '1,234' }));
    expect(screen.getByText('Active Users')).toBeDefined();
    expect(screen.getByText('1,234')).toBeDefined();
  });

  it('renders skeleton when loading', () => {
    const { container } = render(
      createElement(MetricsCard, { label: 'Loading metric', value: '0', loading: true }),
    );
    // Loading hides the value paragraph and renders the Skeleton placeholder.
    expect(screen.queryByText('0')).toBeNull();
    expect(container.querySelector('.bg-muted')).not.toBeNull();
  });

  it('shows positive trend with TrendingUp icon and percentage', () => {
    render(
      createElement(MetricsCard, {
        label: 'Revenue',
        value: '$5,000',
        trend: 12.5,
      }),
    );
    expect(screen.getByText(/\+12\.5%/)).toBeDefined();
  });

  it('shows negative trend with minus sign', () => {
    render(
      createElement(MetricsCard, {
        label: 'Errors',
        value: '5',
        trend: -2.3,
      }),
    );
    expect(screen.getByText(/-2\.3%/)).toBeDefined();
  });

  it('renders the description text when provided', () => {
    render(
      createElement(MetricsCard, {
        label: 'X',
        value: '1',
        description: 'compared to last week',
      }),
    );
    expect(screen.getByText('compared to last week')).toBeDefined();
  });

  it('renders the icon container when an icon is supplied', () => {
    const { container } = render(
      createElement(MetricsCard, {
        label: 'X',
        value: '10',
        icon: TrendingUp,
      }),
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
