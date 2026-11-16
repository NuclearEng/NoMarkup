// Tests for the Fair-Price band surface — covers the loading/error/empty
// states, both display variants (full + compact), every confidence label,
// every geo-fallback note, and the marker clamping inside the p25–p75 track.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  FairPriceBand,
  type FairPriceBandProps,
} from '@/components/analytics/FairPriceBand';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  CONFIDENCE_LABEL,
  FAIR_PRICE_LEVEL,
  type ConfidenceLabel,
  type FairPrice,
} from '@/types';

// The gateway contract only ever sends high/medium/low, so the `default:` arm
// of the confidence switch is unreachable through the union. A future/unknown
// label is still a real wire possibility, so widen one deliberately to prove
// the component degrades to the "Low confidence" presentation.
const UNKNOWN_CONFIDENCE = 'unspecified' as unknown as ConfidenceLabel;

function makeFairPrice(overrides: Partial<FairPrice> = {}): FairPrice {
  return {
    has_data: true,
    price_cents: 30_000,
    p25_cents: 20_000,
    p75_cents: 40_000,
    ci_lo_cents: 18_000,
    ci_hi_cents: 45_000,
    n_eff: 12,
    confidence: 0.87,
    confidence_label: CONFIDENCE_LABEL.HIGH,
    level_used: FAIR_PRICE_LEVEL.ZIP,
    model_version: 'fair-price-v1',
    ...overrides,
  };
}

function renderBand(props: Partial<FairPriceBandProps> = {}) {
  // An explicit `fairPrice: undefined` must stay undefined (empty state), so
  // presence — not a default value — decides whether to seed a fixture.
  const fairPrice = 'fairPrice' in props ? props.fairPrice : makeFairPrice();
  return render(
    <TooltipProvider>
      <FairPriceBand {...props} fairPrice={fairPrice} />
    </TooltipProvider>,
  );
}

/** Matches a whole paragraph's text, including text split across child spans. */
function paragraphText(expected: string) {
  return (_content: string, element: Element | null): boolean =>
    element?.tagName === 'P' && element.textContent === expected;
}

/** Inline `left` offsets of the point + optional current-bid markers. */
function markerOffsets(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="img"] div[style]'),
  ).map((el) => el.style.left);
}

/** Inline widths of the markers — the `large` prop drives marker size. */
function markerWidths(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="img"] div[style]'),
  ).map((el) => el.style.width);
}

describe('FairPriceBand', () => {
  describe('loading state', () => {
    it('renders a decorative full skeleton with no announced content', () => {
      const { container } = renderBand({ isLoading: true, fairPrice: undefined });

      expect(screen.queryByRole('group')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText('Fair Price')).toBeNull();

      const root = container.querySelector('[aria-hidden="true"]');
      expect(root).not.toBeNull();
      expect(root?.children).toHaveLength(4);
    });

    it('renders the shorter compact skeleton when compact', () => {
      const { container } = renderBand({
        isLoading: true,
        compact: true,
        fairPrice: undefined,
      });

      expect(screen.queryByRole('group')).toBeNull();
      const root = container.querySelector('[aria-hidden="true"]');
      expect(root).not.toBeNull();
      expect(root?.children).toHaveLength(3);
    });

    it('forwards className to the skeleton root in both variants', () => {
      const full = renderBand({ isLoading: true, className: 'full-skeleton' });
      expect(full.container.querySelector('.full-skeleton')).not.toBeNull();

      const compact = renderBand({
        isLoading: true,
        compact: true,
        className: 'compact-skeleton',
      });
      expect(compact.container.querySelector('.compact-skeleton')).not.toBeNull();
    });

    it('prefers the skeleton over data when both loading and loaded', () => {
      renderBand({ isLoading: true, fairPrice: makeFairPrice() });
      expect(screen.queryByText('$300.00')).toBeNull();
    });
  });

  describe('error state', () => {
    it('announces an unavailable message as a status', () => {
      renderBand({ isError: true, fairPrice: undefined });

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Fair-price data is unavailable right now.');
    });

    it('prefers the error message over available data', () => {
      renderBand({ isError: true, fairPrice: makeFairPrice() });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Fair-price data is unavailable right now.',
      );
      expect(screen.queryByText('$300.00')).toBeNull();
    });

    it('forwards className on the error root', () => {
      const { container } = renderBand({ isError: true, className: 'error-root' });
      expect(container.querySelector('.error-root')).not.toBeNull();
    });
  });

  describe('empty state', () => {
    it('explains the gap when there is no fair price at all', () => {
      renderBand({ fairPrice: undefined });

      expect(screen.getByRole('status')).toHaveTextContent(
        'Not enough local data yet to estimate a fair price. Check back as more jobs settle.',
      );
    });

    it('explains the gap when has_data is false', () => {
      renderBand({ fairPrice: makeFairPrice({ has_data: false }) });

      expect(screen.getByRole('status')).toHaveTextContent(
        /Not enough local data yet to estimate a fair price/,
      );
      expect(screen.queryByRole('group')).toBeNull();
    });

    it('forwards className on the empty root', () => {
      const { container } = renderBand({ fairPrice: undefined, className: 'empty-root' });
      expect(container.querySelector('.empty-root')).not.toBeNull();
    });
  });

  describe('full variant', () => {
    it('renders the heading, point estimate and going-rate range', () => {
      renderBand();

      const group = screen.getByRole('group', { name: 'Fair-price estimate' });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Fair Price' })).toBeInTheDocument();
      expect(screen.getByText('$300.00')).toBeInTheDocument();
      expect(screen.getByText('fair-price estimate')).toBeInTheDocument();
      expect(screen.getByText('Going rate')).toBeInTheDocument();
      expect(screen.getByText('$200.00 – $400.00')).toBeInTheDocument();
    });

    it('honours a title override', () => {
      renderBand({ title: 'Going Rate Index' });
      expect(screen.getByRole('heading', { name: 'Going Rate Index' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Fair Price' })).toBeNull();
    });

    it('describes the band track for assistive tech', () => {
      renderBand();
      expect(
        screen.getByRole('img', {
          name: 'Going rate $200.00 to $400.00, fair-price estimate $300.00',
        }),
      ).toBeInTheDocument();
    });

    it('pluralises the effective sample size', () => {
      renderBand({ fairPrice: makeFairPrice({ n_eff: 12 }) });
      expect(screen.getByText(/effective settled prices nearby\./)).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    it('uses the singular form for a single effective price', () => {
      renderBand({ fairPrice: makeFairPrice({ n_eff: 1 }) });
      expect(screen.getByText(/effective settled price nearby\./)).toBeInTheDocument();
      expect(screen.queryByText(/effective settled prices nearby\./)).toBeNull();
    });

    it('forwards className on the full root', () => {
      const { container } = renderBand({ className: 'full-root' });
      expect(container.querySelector('.full-root')).not.toBeNull();
    });
  });

  describe('confidence presentation', () => {
    it('labels high confidence with text and an accessible percentage', () => {
      renderBand({
        fairPrice: makeFairPrice({
          confidence_label: CONFIDENCE_LABEL.HIGH,
          confidence: 0.87,
        }),
      });

      expect(screen.getByLabelText('High confidence, 87 percent')).toHaveTextContent(
        'High confidence',
      );
    });

    it('labels medium confidence as moderate', () => {
      renderBand({
        fairPrice: makeFairPrice({
          confidence_label: CONFIDENCE_LABEL.MEDIUM,
          confidence: 0.55,
        }),
      });

      expect(screen.getByLabelText('Moderate confidence, 55 percent')).toHaveTextContent(
        'Moderate confidence',
      );
    });

    it('labels low confidence and rounds the percentage', () => {
      renderBand({
        fairPrice: makeFairPrice({
          confidence_label: CONFIDENCE_LABEL.LOW,
          confidence: 0.234,
        }),
      });

      expect(screen.getByLabelText('Low confidence, 23 percent')).toHaveTextContent(
        'Low confidence',
      );
    });

    it('falls back to the low-confidence presentation for an unknown label', () => {
      renderBand({
        fairPrice: makeFairPrice({
          confidence_label: UNKNOWN_CONFIDENCE,
          confidence: 0.4,
        }),
      });

      expect(screen.getByLabelText('Low confidence, 40 percent')).toHaveTextContent(
        'Low confidence',
      );
    });
  });

  describe('geo fallback notes', () => {
    it.each([
      [FAIR_PRICE_LEVEL.METRO, 'Based on metro-wide data'],
      [FAIR_PRICE_LEVEL.METRO_PARENT, 'Based on regional data'],
      [FAIR_PRICE_LEVEL.NATIONAL, 'Based on nationwide data'],
      [FAIR_PRICE_LEVEL.NATIONAL_PARENT, 'Based on nationwide data'],
      [FAIR_PRICE_LEVEL.SIDE, 'Based on related categories'],
    ])('explains level %i as "%s"', (levelUsed, note) => {
      renderBand({ fairPrice: makeFairPrice({ level_used: levelUsed }) });

      expect(
        screen.getByText(
          new RegExp(`${note} — treat as a rough estimate while local data is thin\\.`),
        ),
      ).toBeInTheDocument();
    });

    it('falls back to a broad-data note for an unmapped level', () => {
      renderBand({ fairPrice: makeFairPrice({ level_used: 42 }) });

      expect(
        screen.getByText(/Based on broader data — treat as a rough estimate/),
      ).toBeInTheDocument();
    });

    it('shows no note when the exact zip had enough data', () => {
      renderBand({
        fairPrice: makeFairPrice({
          level_used: FAIR_PRICE_LEVEL.ZIP,
          confidence_label: CONFIDENCE_LABEL.HIGH,
        }),
      });

      expect(
        screen.queryByText(/Based on (metro|regional|nationwide|related|broader)/),
      ).toBeNull();
      expect(screen.queryByText(/treat as a rough estimate/)).toBeNull();
    });

    it('shows no note for low confidence at zip level, since there is nothing to disclose', () => {
      renderBand({
        fairPrice: makeFairPrice({
          level_used: FAIR_PRICE_LEVEL.ZIP,
          confidence_label: CONFIDENCE_LABEL.LOW,
        }),
      });

      expect(screen.getByLabelText(/Low confidence/)).toBeInTheDocument();
      expect(screen.queryByText(/treat as a rough estimate/)).toBeNull();
    });
  });

  describe('compact variant', () => {
    it('renders the one-line settle hint with the going-rate range', () => {
      renderBand({ compact: true });

      expect(screen.getByRole('group', { name: 'Fair-price hint' })).toBeInTheDocument();
      expect(screen.getByText('Bids here usually settle')).toBeInTheDocument();
      expect(screen.getByText(paragraphText('$200.00–$400.00'))).toBeInTheDocument();
      expect(screen.getByText('$300.00')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).toBeNull();
    });

    it('keeps the same accessible band description', () => {
      renderBand({ compact: true });
      expect(
        screen.getByRole('img', {
          name: 'Going rate $200.00 to $400.00, fair-price estimate $300.00',
        }),
      ).toBeInTheDocument();
    });

    it('shows the bare geo note without the long caveat', () => {
      renderBand({
        compact: true,
        fairPrice: makeFairPrice({ level_used: FAIR_PRICE_LEVEL.METRO }),
      });

      expect(screen.getByText('Based on metro-wide data')).toBeInTheDocument();
      expect(screen.queryByText(/treat as a rough estimate/)).toBeNull();
    });

    it('omits the geo note at zip level', () => {
      renderBand({ compact: true, fairPrice: makeFairPrice({ level_used: FAIR_PRICE_LEVEL.ZIP }) });
      expect(screen.queryByText(/Based on/)).toBeNull();
    });

    it('omits the tooltip trigger', () => {
      renderBand({ compact: true });
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('forwards className on the compact root', () => {
      const { container } = renderBand({ compact: true, className: 'compact-root' });
      expect(container.querySelector('.compact-root')).not.toBeNull();
    });
  });

  describe('band markers', () => {
    it('places the point estimate proportionally and omits the bid marker by default', () => {
      const { container } = renderBand();
      expect(markerOffsets(container)).toEqual(['50%']);
    });

    it('omits the bid marker when the current bid is null', () => {
      const { container } = renderBand({ currentBidCents: null });
      expect(markerOffsets(container)).toEqual(['50%']);
    });

    it('places an in-range current bid proportionally', () => {
      const { container } = renderBand({ currentBidCents: 25_000 });
      expect(markerOffsets(container)).toEqual(['50%', '25%']);
    });

    it('clamps a current bid below p25 to the start of the band', () => {
      const { container } = renderBand({ currentBidCents: 1_000 });
      expect(markerOffsets(container)).toEqual(['50%', '0%']);
    });

    it('clamps a current bid above p75 to the end of the band', () => {
      const { container } = renderBand({ currentBidCents: 999_999 });
      expect(markerOffsets(container)).toEqual(['50%', '100%']);
    });

    it('clamps a point estimate above p75 to the end of the band', () => {
      const { container } = renderBand({
        fairPrice: makeFairPrice({ price_cents: 90_000 }),
      });
      expect(markerOffsets(container)).toEqual(['100%']);
    });

    it('clamps a point estimate below p25 to the start of the band', () => {
      const { container } = renderBand({
        fairPrice: makeFairPrice({ price_cents: 100 }),
      });
      expect(markerOffsets(container)).toEqual(['0%']);
    });

    it('centres the point and drops the bid marker when the band has no spread', () => {
      const { container } = renderBand({
        fairPrice: makeFairPrice({ p25_cents: 30_000, p75_cents: 30_000 }),
        currentBidCents: 25_000,
      });
      expect(markerOffsets(container)).toEqual(['50%']);
    });

    it('draws larger markers on the full variant than the compact one', () => {
      const full = renderBand({ currentBidCents: 25_000 });
      expect(markerWidths(full.container)).toEqual(['14px', '12px']);

      const compact = renderBand({ compact: true, currentBidCents: 25_000 });
      expect(markerWidths(compact.container)).toEqual(['10px', '9px']);
    });
  });

  describe('explainer tooltip', () => {
    it('exposes a labelled trigger that is hidden until focused', async () => {
      const user = userEvent.setup();
      renderBand();

      const trigger = screen.getByRole('button', {
        name: 'How the fair-price band is computed',
      });
      expect(trigger).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(/computed from real settled prices nearby/)).toBeNull();

      await user.tab();
      expect(trigger).toHaveFocus();

      expect(
        screen.getAllByText(/computed from real settled prices nearby/).length,
      ).toBeGreaterThan(0);
      expect(trigger).toHaveAttribute('aria-describedby');
    });

    it('repeats the confidence label inside the explainer', async () => {
      const user = userEvent.setup();
      renderBand({
        fairPrice: makeFairPrice({ confidence_label: CONFIDENCE_LABEL.MEDIUM }),
      });

      await user.tab();

      // Chip text plus the tooltip heading.
      expect(screen.getAllByText('Moderate confidence').length).toBeGreaterThan(1);
    });
  });
});
