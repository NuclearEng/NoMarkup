import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProviderProfileCard } from '@/components/providers/ProviderProfileCard';
import { TRUST_TIER, type ProviderProfile } from '@/types';

const baseProfile: ProviderProfile = {
  id: 'p-1',
  user_id: 'u-1',
  business_name: 'Acme Plumbing',
  bio: 'Trusted plumber serving the bay area for 10+ years.',
  service_address: '123 Market St',
  service_location: { latitude: 37.77, longitude: -122.42 },
  service_radius_km: 30,
  default_payment_timing: 'milestone',
  default_milestones: [],
  cancellation_policy: null,
  warranty_terms: null,
  instant_enabled: true,
  instant_available: true,
  jobs_completed: 42,
  avg_response_time_minutes: 30,
  on_time_rate: 0.95,
  profile_completeness: 90,
  stripe_onboarding_complete: true,
  service_categories: [
    { id: 'c-1', name: 'Plumbing', slug: 'plumbing', level: 0, parent_name: null },
    { id: 'c-2', name: 'Drain Cleaning', slug: 'drain', level: 0, parent_name: null },
  ],
  portfolio: [],
  member_since: '2024-01-01T00:00:00Z',
  response_time_label: 'Responds in 1 hour',
};

describe('ProviderProfileCard', () => {
  it('renders the business name as the heading when present', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
    expect(screen.getByText('Jane Doe')).toBeDefined();
  });

  it('falls back to display name when business name is missing', () => {
    render(
      <ProviderProfileCard
        profile={{ ...baseProfile, business_name: null }}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    // The heading text should be Jane Doe since businessName is null
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the trust tier badge label when provided', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
        trustTier={TRUST_TIER.TRUSTED}
      />,
    );
    expect(screen.getByText('Trusted')).toBeDefined();
  });

  it('renders the Verified badge when verified=true', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
        verified
      />,
    );
    expect(screen.getByText('Verified')).toBeDefined();
  });

  it('renders rating with accessible aria-label and job count', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
        averageRating={4.5}
      />,
    );
    expect(screen.getByLabelText('Rating: 4.5 out of 5')).toBeDefined();
    expect(screen.getByText('(42 jobs)')).toBeDefined();
  });

  it('renders the bio text', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    expect(screen.getByText(/Trusted plumber/)).toBeDefined();
  });

  it('renders service category badges and a +N more chip when over 5', () => {
    const many = {
      ...baseProfile,
      service_categories: Array.from({ length: 7 }, (_, i) => ({
        id: `c-${String(i)}`,
        name: `Cat ${String(i)}`,
        slug: `cat-${String(i)}`,
        level: 0,
        parent_name: null,
      })),
    };
    render(
      <ProviderProfileCard profile={many} displayName="Jane" avatarUrl={null} />,
    );
    expect(screen.getByText('+2 more')).toBeDefined();
  });

  it('renders the response time badge when label is provided', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    expect(screen.getByText('Responds in 1 hour')).toBeDefined();
  });

  // ---- DEEPENING: branches uncovered (73, 85, 91, 106) ----

  it('renders unfilled stars (text-muted-foreground branch) for low ratings', () => {
    const { container } = render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
        averageRating={2}
      />,
    );
    // With averageRating=2, only 2 of 5 stars get the yellow fill class — the
    // remaining 3 should land on the text-muted-foreground branch (line 73).
    const stars = container.querySelectorAll('svg.lucide-star');
    const muted = Array.from(stars).filter((s) => s.classList.contains('text-muted-foreground'));
    expect(muted.length).toBeGreaterThanOrEqual(3);
  });

  it('omits the response time badge when label is missing (line 85 branch)', () => {
    render(
      <ProviderProfileCard
        profile={{ ...baseProfile, response_time_label: null as unknown as string }}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    expect(screen.queryByText('Responds in 1 hour')).toBeNull();
  });

  it('omits the bio block when bio is null (line 91 branch)', () => {
    render(
      <ProviderProfileCard
        profile={{ ...baseProfile, bio: null }}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    expect(screen.queryByText(/Trusted plumber/)).toBeNull();
  });

  it('omits the service-category section when there are no categories (line 106 branch)', () => {
    render(
      <ProviderProfileCard
        profile={{ ...baseProfile, service_categories: [] }}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    // With no categories, neither original badges nor the +N more chip render.
    expect(screen.queryByText('Plumbing')).toBeNull();
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });

  it('renders without crashing when avatarUrl is provided', () => {
    // shadcn AvatarImage may not load in jsdom; just assert the heading renders.
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl="https://cdn/jane.png"
      />,
    );
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
  });

  it('omits the rating row when averageRating is null', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
        averageRating={null}
      />,
    );
    expect(screen.queryByLabelText(/Rating:/)).toBeNull();
  });

  it('omits trust tier badge when trustTier is undefined', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
      />,
    );
    expect(screen.queryByText('Trusted')).toBeNull();
  });

  it('omits Verified badge when verified is false', () => {
    render(
      <ProviderProfileCard
        profile={baseProfile}
        displayName="Jane Doe"
        avatarUrl={null}
        verified={false}
      />,
    );
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('does not render +N more chip when there are exactly 5 categories', () => {
    const five = {
      ...baseProfile,
      service_categories: Array.from({ length: 5 }, (_, i) => ({
        id: `c-${String(i)}`,
        name: `Cat ${String(i)}`,
        slug: `cat-${String(i)}`,
        level: 0,
        parent_name: null,
      })),
    };
    render(<ProviderProfileCard profile={five} displayName="Jane" avatarUrl={null} />);
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });
});
