import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PreferredProvidersSection } from '@/components/properties/PreferredProvidersSection';
import type { PreferredProvider } from '@/hooks/useProperties';

const providers: PreferredProvider[] = [
  {
    provider_id: 'prov-1',
    display_name: 'Ace Plumbing',
    completed_count: 5,
    last_completed_at: '2026-07-01T00:00:00Z',
    is_preferred: true,
  },
  {
    provider_id: 'prov-2',
    display_name: 'Bob Electric',
    completed_count: 2,
    last_completed_at: null,
    is_preferred: false,
  },
];

describe('PreferredProvidersSection', () => {
  it('renders top providers with Preferred badge at threshold', () => {
    render(
      <PreferredProvidersSection
        providers={providers}
        isLoading={false}
        isError={false}
        scope="account"
      />,
    );
    expect(screen.getByText('Ace Plumbing')).toBeDefined();
    expect(screen.getByText('Bob Electric')).toBeDefined();
    expect(screen.getByLabelText(/preferred provider/i)).toBeDefined();
    expect(screen.getByLabelText(/2 of 3 jobs toward preferred/i)).toBeDefined();
    expect(screen.getByText(/5 completed jobs/i)).toBeDefined();
  });

  it('shows soft empty state on account scope', () => {
    render(
      <PreferredProvidersSection
        providers={[]}
        isLoading={false}
        isError={false}
        scope="account"
      />,
    );
    expect(screen.getByText(/no completed contracts yet/i)).toBeDefined();
  });

  it('hides section when property-scoped list is empty', () => {
    const { container } = render(
      <PreferredProvidersSection
        providers={[]}
        isLoading={false}
        isError={false}
        scope="property"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows fail-soft error copy without crashing', () => {
    render(
      <PreferredProvidersSection
        providers={undefined}
        isLoading={false}
        isError
        scope="account"
      />,
    );
    expect(screen.getByText(/provider summary unavailable/i)).toBeDefined();
  });

  it('shows loading skeletons', () => {
    const { container } = render(
      <PreferredProvidersSection
        providers={undefined}
        isLoading
        isError={false}
        scope="account"
      />,
    );
    expect(container.querySelectorAll('[class*="animate"]').length + container.querySelectorAll('.h-12').length).toBeGreaterThan(0);
  });
});
