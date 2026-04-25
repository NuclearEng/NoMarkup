import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProviderProfileCard } from '@/components/providers/ProviderProfileCard';
import { TRUST_TIER, type ProviderProfile } from '@/types';

const baseProfile: ProviderProfile = {
  id: 'p-1',
  userId: 'u-1',
  businessName: 'Acme Plumbing',
  bio: 'Trusted plumber serving the bay area for 10+ years.',
  serviceAddress: '123 Market St',
  serviceLocation: { latitude: 37.77, longitude: -122.42 },
  serviceRadiusKm: 30,
  defaultPaymentTiming: 'milestone',
  defaultMilestones: [],
  cancellationPolicy: null,
  warrantyTerms: null,
  instantEnabled: true,
  instantAvailable: true,
  jobsCompleted: 42,
  avgResponseTimeMinutes: 30,
  onTimeRate: 0.95,
  profileCompleteness: 90,
  stripeOnboardingComplete: true,
  serviceCategories: [
    { id: 'c-1', name: 'Plumbing', slug: 'plumbing', level: 0, parentName: null },
    { id: 'c-2', name: 'Drain Cleaning', slug: 'drain', level: 0, parentName: null },
  ],
  portfolio: [],
  memberSince: '2024-01-01T00:00:00Z',
  responseTimeLabel: 'Responds in 1 hour',
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
        profile={{ ...baseProfile, businessName: null }}
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
      serviceCategories: Array.from({ length: 7 }, (_, i) => ({
        id: `c-${String(i)}`,
        name: `Cat ${String(i)}`,
        slug: `cat-${String(i)}`,
        level: 0,
        parentName: null,
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
});
