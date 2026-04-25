// SocialProofWidget — pure presentational. No mocks.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { SocialProofWidget } from '@/components/terminal/widgets/social-proof-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('SocialProofWidget', () => {
  it('renders the bid count and "providers competing" copy', () => {
    render(createElement(SocialProofWidget, makeWidgetProps()));
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText(/providers competing/)).toBeDefined();
  });

  it('renders savings percentage', () => {
    render(createElement(SocialProofWidget, makeWidgetProps()));
    // 50000 starting, 25000 current => 50% off
    expect(screen.getByText(/50% below asking price/)).toBeDefined();
  });

  it('shows waiting placeholder when no bids', () => {
    render(
      createElement(SocialProofWidget, makeWidgetProps({ sim: makeSim({ bidCount: 0 }) })),
    );
    expect(screen.getByText(/Waiting for bids/)).toBeDefined();
  });
});
